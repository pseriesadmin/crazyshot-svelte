/**
 * xlsxImages.ts — .xlsx 시트에 들어 있는 그림(직인·서명·로고 등)을 꺼내 스프레드시트 양식의 "이미지 겹침"으로 옮기기 (2026-10-29)
 *
 * 엑셀 파일 안: 시트 → 그리기(drawing) → 그림 위치(앵커: 시작 칸+오프셋, 크기) + 그림 파일(xl/media).
 * 우리 양식: 칸 값 끝에 이미지 표식(cs-image://너비:가로이동:세로이동:주소)을 붙이는 방식 — 주소는 http(s) 여야 하므로
 * 그림 파일을 저장소에 올린 뒤 표식을 만든다(올리기는 호출부가 맡는다).
 * 브라우저가 못 그리는 형식(.wmf/.emf 등)은 건너뛰고 알린다. 선·도형은 가져오지 않는다.
 * 클라이언트 전용(DOMParser).
 */
import JSZip from 'jszip'
import type { SpreadsheetDocument, SpreadsheetSheet } from '$lib/types/contract-document'
import { toImageOverlayMarker } from '$lib/types/sheet-format'
import { readBiffWorkbookCached } from './xlsBiff'

const SS_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const XDR_NS = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'
const DML_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const EMU_PER_PX = 9525
/** 행 높이 정보가 없을 때 쓰는 기본 행 높이(px) */
const FALLBACK_ROW_PX = 20
/** 올릴 수 있는 그림 형식 — 저장소 업로드 규칙(PNG/JPEG/WebP)과 같다 */
const MIME_BY_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }
/** 그림 1개 최대 크기 */
export const MAX_IMPORT_IMAGE_BYTES = 10 * 1024 * 1024

export interface SheetImage {
  /** 파일 안 그림 경로(같은 그림이 여러 번 쓰였는지 구분) */
  mediaPath: string
  mime: string
  bytes: Uint8Array
  /** 시작 칸(0부터)과 그 칸 안 이동량(px) */
  col: number
  row: number
  colOffsetPx: number
  rowOffsetPx: number
  widthPx: number
  heightPx: number
}

export interface WorkbookImages {
  /** 시트 이름 → 그 시트의 그림들 */
  bySheet: Map<string, SheetImage[]>
  /** 형식이 맞지 않거나 너무 커서 건너뛴 그림 수 */
  skipped: number
}

export function dirOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/') + 1)
}

/** 상대 경로("../media/a.png")를 zip 안 절대 경로로 */
export function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = (dirOf(base) + target).split('/')
  const out: string[] = []
  for (const p of parts) {
    if (p === '..') out.pop()
    else if (p && p !== '.') out.push(p)
  }
  return out.join('/')
}

export async function readRels(zip: JSZip, relsPath: string): Promise<Map<string, { target: string; type: string }>> {
  const map = new Map<string, { target: string; type: string }>()
  const f = zip.file(relsPath)
  if (!f) return map
  const doc = new DOMParser().parseFromString(await f.async('string'), 'application/xml')
  for (const el of Array.from(doc.getElementsByTagNameNS(PKG_REL_NS, 'Relationship'))) {
    const id = el.getAttribute('Id')
    const target = el.getAttribute('Target')
    if (id && target) map.set(id, { target, type: el.getAttribute('Type') ?? '' })
  }
  return map
}

const num = (el: Element | undefined, tag: string): number => {
  const v = el ? Array.from(el.children).find((c) => c.localName === tag)?.textContent : undefined
  const n = parseInt(v ?? '0', 10)
  return Number.isFinite(n) ? n : 0
}

/** 통합 문서의 모든 시트에서 그림을 꺼낸다. 실패하면 빈 결과(값·서식 가져오기에는 영향 없음) */
export async function extractWorkbookImages(arrayBuffer: ArrayBuffer): Promise<WorkbookImages> {
  const result: WorkbookImages = { bySheet: new Map(), skipped: 0 }
  // 구형 엑셀(.xls) — 바이너리 안의 그리기 레코드에서 JPEG·PNG 그림을 꺼낸다
  const biff = readBiffWorkbookCached(arrayBuffer)
  if (biff) {
    result.skipped = biff.skippedImages
    for (const [name, list] of biff.imagesBySheet) {
      const images: SheetImage[] = []
      for (const im of list) {
        if (im.bytes.byteLength > MAX_IMPORT_IMAGE_BYTES) { result.skipped++; continue }
        images.push({ mediaPath: im.mediaPath, mime: im.mime, bytes: im.bytes, col: im.col, row: im.row, colOffsetPx: im.colOffsetPx, rowOffsetPx: im.rowOffsetPx, widthPx: im.widthPx, heightPx: im.heightPx })
      }
      if (images.length) result.bySheet.set(name, images)
    }
    return result
  }
  try {
    const zip = await JSZip.loadAsync(arrayBuffer)
    const wbFile = zip.file('xl/workbook.xml')
    if (!wbFile) return result
    const wbRels = await readRels(zip, 'xl/_rels/workbook.xml.rels')
    const wbDoc = new DOMParser().parseFromString(await wbFile.async('string'), 'application/xml')

    for (const sheetEl of Array.from(wbDoc.getElementsByTagNameNS(SS_NS, 'sheet'))) {
      const name = sheetEl.getAttribute('name')
      const rid = sheetEl.getAttributeNS(REL_NS, 'id') ?? sheetEl.getAttribute('r:id')
      const rel = rid ? wbRels.get(rid) : undefined
      if (!name || !rel) continue
      const sheetPath = resolvePath('xl/workbook.xml', rel.target)
      const sheetRels = await readRels(zip, `${dirOf(sheetPath)}_rels/${sheetPath.slice(sheetPath.lastIndexOf('/') + 1)}.rels`)
      const sheetFile = zip.file(sheetPath)
      if (!sheetFile) continue
      const sheetDoc = new DOMParser().parseFromString(await sheetFile.async('string'), 'application/xml')
      const drawingEl = sheetDoc.getElementsByTagNameNS(SS_NS, 'drawing')[0]
      const drawingRid = drawingEl?.getAttributeNS(REL_NS, 'id') ?? drawingEl?.getAttribute('r:id')
      const drawingRel = drawingRid ? sheetRels.get(drawingRid) : undefined
      if (!drawingRel) continue
      const drawingPath = resolvePath(sheetPath, drawingRel.target)
      const drawingFile = zip.file(drawingPath)
      if (!drawingFile) continue
      const drawingRels = await readRels(zip, `${dirOf(drawingPath)}_rels/${drawingPath.slice(drawingPath.lastIndexOf('/') + 1)}.rels`)
      const drawingDoc = new DOMParser().parseFromString(await drawingFile.async('string'), 'application/xml')

      const images: SheetImage[] = []
      const anchors = Array.from(drawingDoc.documentElement.children).filter((el) => /Anchor$/.test(el.localName))
      for (const anchor of anchors) {
        const pic = Array.from(anchor.children).find((el) => el.localName === 'pic' && el.namespaceURI === XDR_NS)
        if (!pic) continue // 선·도형 등은 가져오지 않는다
        const blip = pic.getElementsByTagNameNS(DML_NS, 'blip')[0]
        const embed = blip?.getAttributeNS(REL_NS, 'embed') ?? blip?.getAttribute('r:embed')
        const mediaRel = embed ? drawingRels.get(embed) : undefined
        if (!mediaRel) continue
        const mediaPath = resolvePath(drawingPath, mediaRel.target)
        const ext = mediaPath.split('.').pop()?.toLowerCase() ?? ''
        const mime = MIME_BY_EXT[ext]
        const mediaFile = zip.file(mediaPath)
        if (!mime || !mediaFile) { result.skipped++; continue }
        const bytes = await mediaFile.async('uint8array')
        if (bytes.byteLength > MAX_IMPORT_IMAGE_BYTES) { result.skipped++; continue }

        const from = Array.from(anchor.children).find((el) => el.localName === 'from')
        // 크기는 그림 서식(a:xfrm 아래 a:ext cx/cy). 주의: pic 안에는 확장 정보용 a:ext(uri=…)도 있어 xfrm 안에서만 찾는다
        const xfrm = pic.getElementsByTagNameNS(DML_NS, 'xfrm')[0]
        const ext2 = xfrm ? Array.from(xfrm.children).find((el) => el.localName === 'ext') : undefined
        const cx = parseInt(ext2?.getAttribute('cx') ?? '0', 10)
        const cy = parseInt(ext2?.getAttribute('cy') ?? '0', 10)
        const anchorExt = Array.from(anchor.children).find((el) => el.localName === 'ext')
        const widthEmu = cx || parseInt(anchorExt?.getAttribute('cx') ?? '0', 10)
        const heightEmu = cy || parseInt(anchorExt?.getAttribute('cy') ?? '0', 10)
        const col = num(from, 'col')
        const row = num(from, 'row')
        // 크기 정보(xfrm/ext)가 없는 그림은 위치를 정할 수 없어 건너뛴다
        if (!widthEmu || !heightEmu) { result.skipped++; continue }
        images.push({
          mediaPath, mime, bytes, col, row,
          colOffsetPx: Math.round(num(from, 'colOff') / EMU_PER_PX),
          rowOffsetPx: Math.round(num(from, 'rowOff') / EMU_PER_PX),
          widthPx: Math.max(1, Math.round(widthEmu / EMU_PER_PX)),
          heightPx: Math.max(1, Math.round(heightEmu / EMU_PER_PX)),
        })
      }
      if (images.length) result.bySheet.set(name, images)
    }
  } catch {
    return { bySheet: new Map(), skipped: result.skipped }
  }
  return result
}

export interface ImagePlacement {
  row: number
  col: number
  width: number
  offsetX: number
  offsetY: number
}

/**
 * 그림의 중심이 놓인 칸과 그 칸 중심에서의 이동량(px)을 구한다. 병합된 칸 안이면 병합 앵커 칸 기준(그 칸이 차지하는 전체 영역의 중심)으로.
 */
export function placeImageInSheet(sheet: SpreadsheetSheet, img: SheetImage): ImagePlacement | null {
  const colW = sheet.colWidths.map((w) => (typeof w === 'number' && w >= 0 ? w : 64))
  const rowH = (r: number): number => {
    const h = sheet.rowHeights?.[r]
    return typeof h === 'number' && h > 0 ? h : FALLBACK_ROW_PX
  }
  const rowCount = sheet.rows.length
  const colCount = colW.length
  if (rowCount === 0 || colCount === 0) return null

  const startX = colW.slice(0, img.col).reduce((a, b) => a + b, 0) + img.colOffsetPx
  let startY = 0
  for (let r = 0; r < Math.min(img.row, rowCount); r++) startY += rowH(r)
  startY += img.rowOffsetPx
  const cx = startX + img.widthPx / 2
  const cy = startY + img.heightPx / 2

  // 중심이 놓인 칸 찾기(시트 밖이면 마지막 칸)
  let c = 0
  let x0 = 0
  while (c < colCount - 1 && x0 + colW[c] <= cx) { x0 += colW[c]; c++ }
  let r = 0
  let y0 = 0
  while (r < rowCount - 1 && y0 + rowH(r) <= cy) { y0 += rowH(r); r++ }

  // 병합 영역 안이면 앵커 칸 + 병합 영역 전체 기준
  let aRow = r, aCol = c, areaX0 = x0, areaY0 = y0, areaW = colW[c], areaH = rowH(r)
  const m = sheet.merges.find((mm) => r >= mm.s.r && r <= mm.e.r && c >= mm.s.c && c <= mm.e.c)
  if (m) {
    aRow = m.s.r
    aCol = m.s.c
    areaX0 = colW.slice(0, m.s.c).reduce((a, b) => a + b, 0)
    areaW = colW.slice(m.s.c, m.e.c + 1).reduce((a, b) => a + b, 0)
    areaY0 = 0
    for (let i = 0; i < m.s.r; i++) areaY0 += rowH(i)
    areaH = 0
    for (let i = m.s.r; i <= m.e.r; i++) areaH += rowH(i)
  }
  return {
    row: aRow,
    col: aCol,
    width: Math.min(1200, Math.max(20, img.widthPx)),
    offsetX: Math.round(cx - (areaX0 + areaW / 2)),
    offsetY: Math.round(cy - (areaY0 + areaH / 2)),
  }
}

/** 올린 그림 주소를 칸 값 끝에 이미지 표식으로 붙인다(시트를 바꾼 새 문서를 돌려준다) */
export function applyImageMarkers(
  doc: SpreadsheetDocument,
  placed: { sheetIndex: number; placement: ImagePlacement; url: string }[],
): SpreadsheetDocument {
  const sheets = doc.sheets.map((s) => ({ ...s, rows: s.rows.map((row) => [...row]) }))
  for (const { sheetIndex, placement: p, url } of placed) {
    const row = sheets[sheetIndex]?.rows[p.row]
    if (!row || p.col >= row.length) continue
    row[p.col] = `${row[p.col] ?? ''}${toImageOverlayMarker(url, p.width, p.offsetX, p.offsetY)}`
  }
  return { ...doc, sheets }
}
