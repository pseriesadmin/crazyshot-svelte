/**
 * xlsxExtras.ts — .xlsx 의 숨김 시트·틀 고정·하이퍼링크·선(제목 밑줄 등)을 스프레드시트 양식으로 옮기기 (2026-10-29)
 *
 *  · 숨김 시트  workbook.xml 의 state="hidden|veryHidden" → sheet.hidden
 *  · 틀 고정    sheetView 의 pane(xSplit·ySplit, frozen) → sheet.freeze
 *  · 하이퍼링크 hyperlinks(외부 http/https/mailto) → 칸 값 끝 링크 표식
 *  · 선         그리기의 직선(가로·세로)을 가까운 칸 경계의 테두리로. 사선·도형·글상자는 가져오지 않는다.
 * 모두 실패해도 값·서식 가져오기에는 영향이 없다(빈 결과). 클라이언트 전용(DOMParser).
 */
import JSZip from 'jszip'
import type { SpreadsheetDocument, SpreadsheetSheet } from '$lib/types/contract-document'
import { toLinkMarker, type XlsxCellFormatting } from '$lib/types/sheet-format'
import { dirOf, readRels, resolvePath } from './xlsxImages'
import { readBiffWorkbookCached } from './xlsBiff'

const SS_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const DML_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const EMU_PER_PX = 9525
const FALLBACK_ROW_PX = 20
const FALLBACK_COL_PX = 64
const SAFE_LINK = /^(https?:\/\/|mailto:)[^\s"'<>]+$/i

export interface DrawnLine {
  fromCol: number; fromColOffPx: number; fromRow: number; fromRowOffPx: number
  toCol: number; toColOffPx: number; toRow: number; toRowOffPx: number
  /** 'solid'|'dashed'|'dotted'|'double' + 굵기(px) + 색 */
  style: 'solid' | 'dashed' | 'dotted' | 'double'
  widthPx: number
  color: string
}

export interface SheetExtras {
  hidden: boolean
  freeze: { rows: number; cols: number } | null
  links: { row: number; col: number; url: string; display: string }[]
  lines: DrawnLine[]
}

export type WorkbookExtras = Map<string, SheetExtras>

/** "B7" → {row:6, col:1} (범위 "A1:B2"면 왼쪽 위) */
export function parseCellRef(ref: string): { row: number; col: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})/.exec(ref.trim())
  if (!m) return null
  let col = 0
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { row: parseInt(m[2], 10) - 1, col: col - 1 }
}

const kid = (el: Element | undefined, name: string): Element | undefined =>
  el ? Array.from(el.children).find((c) => c.localName === name) : undefined
const n = (el: Element | undefined, name: string): number => {
  const v = parseInt(kid(el, name)?.textContent ?? '0', 10)
  return Number.isFinite(v) ? v : 0
}

/** 그리기 XML 에서 가로·세로에 가까운 직선만 꺼낸다(순수 함수 — 단위 시험용) */
export function parseDrawnLines(drawingXml: string): DrawnLine[] {
  const doc = new DOMParser().parseFromString(drawingXml, 'application/xml')
  const out: DrawnLine[] = []
  for (const anchor of Array.from(doc.documentElement.children).filter((el) => el.localName === 'twoCellAnchor')) {
    const shape = Array.from(anchor.children).find((el) => el.localName === 'sp' || el.localName === 'cxnSp')
    if (!shape) continue
    const prst = shape.getElementsByTagNameNS(DML_NS, 'prstGeom')[0]?.getAttribute('prst') ?? ''
    if (prst !== 'line' && prst !== 'straightConnector1') continue
    const from = kid(anchor, 'from')
    const to = kid(anchor, 'to')
    if (!from || !to) continue
    const ln = shape.getElementsByTagNameNS(DML_NS, 'ln')[0]
    const wEmu = parseInt(ln?.getAttribute('w') ?? '9525', 10)
    const cmpd = ln?.getAttribute('cmpd') ?? 'sng'
    const dash = ln?.getElementsByTagNameNS(DML_NS, 'prstDash')[0]?.getAttribute('val') ?? ''
    let widthPx = Math.max(1, Math.round((Number.isFinite(wEmu) ? wEmu : 9525) / EMU_PER_PX))
    let style: DrawnLine['style'] = 'solid'
    if (cmpd !== 'sng') { style = 'double'; widthPx = Math.max(3, widthPx) }
    else if (/dot/i.test(dash) && !/dash/i.test(dash)) style = 'dotted'
    else if (/dash/i.test(dash)) style = 'dashed'
    const srgb = ln?.getElementsByTagNameNS(DML_NS, 'srgbClr')[0]?.getAttribute('val')
    out.push({
      fromCol: n(from, 'col'), fromColOffPx: Math.round(n(from, 'colOff') / EMU_PER_PX),
      fromRow: n(from, 'row'), fromRowOffPx: Math.round(n(from, 'rowOff') / EMU_PER_PX),
      toCol: n(to, 'col'), toColOffPx: Math.round(n(to, 'colOff') / EMU_PER_PX),
      toRow: n(to, 'row'), toRowOffPx: Math.round(n(to, 'rowOff') / EMU_PER_PX),
      style, widthPx: Math.min(6, widthPx), color: srgb && /^[0-9A-Fa-f]{6}$/.test(srgb) ? `#${srgb.toUpperCase()}` : '#000000',
    })
  }
  return out
}

/** 통합 문서에서 시트별 부가 정보를 꺼낸다. 실패하면 빈 Map */
export async function extractWorkbookExtras(arrayBuffer: ArrayBuffer): Promise<WorkbookExtras> {
  const result: WorkbookExtras = new Map()
  // 구형 엑셀(.xls) — 숨김 시트만 읽는다(틀 고정·하이퍼링크·선은 바이너리 해석 범위 밖)
  const biff = readBiffWorkbookCached(arrayBuffer)
  if (biff) {
    for (const sh of biff.sheets) if (sh.hidden) result.set(sh.name, { hidden: true, freeze: null, links: [], lines: [] })
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
      const extras: SheetExtras = { hidden: ['hidden', 'veryHidden'].includes(sheetEl.getAttribute('state') ?? ''), freeze: null, links: [], lines: [] }

      const sheetPath = resolvePath('xl/workbook.xml', rel.target)
      const sheetFile = zip.file(sheetPath)
      if (sheetFile) {
        const sheetRels = await readRels(zip, `${dirOf(sheetPath)}_rels/${sheetPath.slice(sheetPath.lastIndexOf('/') + 1)}.rels`)
        const doc = new DOMParser().parseFromString(await sheetFile.async('string'), 'application/xml')

        const pane = doc.getElementsByTagNameNS(SS_NS, 'pane')[0]
        if (pane && /frozen/i.test(pane.getAttribute('state') ?? '')) {
          const cols = Math.max(0, parseInt(pane.getAttribute('xSplit') ?? '0', 10) || 0)
          const rows = Math.max(0, parseInt(pane.getAttribute('ySplit') ?? '0', 10) || 0)
          if (cols > 0 || rows > 0) extras.freeze = { rows, cols }
        }

        for (const h of Array.from(doc.getElementsByTagNameNS(SS_NS, 'hyperlink'))) {
          const hrid = h.getAttributeNS(REL_NS, 'id') ?? h.getAttribute('r:id')
          const target = hrid ? sheetRels.get(hrid)?.target : undefined // 시트 안 이동(location)은 제외 — 외부 주소만
          const pos = parseCellRef(h.getAttribute('ref') ?? '')
          if (target && pos && SAFE_LINK.test(target)) extras.links.push({ ...pos, url: target, display: h.getAttribute('display') ?? '' })
        }

        const drawingEl = doc.getElementsByTagNameNS(SS_NS, 'drawing')[0]
        const drid = drawingEl?.getAttributeNS(REL_NS, 'id') ?? drawingEl?.getAttribute('r:id')
        const drel = drid ? sheetRels.get(drid) : undefined
        if (drel) {
          const dFile = zip.file(resolvePath(sheetPath, drel.target))
          if (dFile) extras.lines = parseDrawnLines(await dFile.async('string'))
        }
      }
      result.set(name, extras)
    }
  } catch {
    return new Map()
  }
  return result
}

const colPx = (s: SpreadsheetSheet, c: number): number => {
  const w = s.colWidths[c]
  return typeof w === 'number' && w >= 0 ? w : FALLBACK_COL_PX
}
const rowPx = (s: SpreadsheetSheet, r: number): number => {
  const h = s.rowHeights?.[r]
  return typeof h === 'number' && h > 0 ? h : FALLBACK_ROW_PX
}

/** 직선을 가장 가까운 칸 경계의 테두리로 바꿔 서식 배열에 넣는다(이미 더 굵은 테두리가 있으면 그대로) */
export function applyLinesToSheet(sheet: SpreadsheetSheet, lines: DrawnLine[]): SpreadsheetSheet {
  const fmt: XlsxCellFormatting[][] = sheet.cellFormatting.map((r) => r.map((c) => ({ ...c })))
  const rowCount = sheet.rows.length
  const colCount = sheet.rows[0]?.length ?? 0
  const ensure = (r: number, c: number): XlsxCellFormatting | null => {
    if (r < 0 || c < 0 || r >= rowCount || c >= colCount) return null
    while (fmt.length <= r) fmt.push([])
    while (fmt[r].length <= c) fmt[r].push({})
    return fmt[r][c]
  }
  const widthOf = (css: string | undefined): number => parseInt(css ?? '0', 10) || 0
  const setSide = (r: number, c: number, side: 'borderTop' | 'borderBottom' | 'borderLeft' | 'borderRight', ln: DrawnLine): void => {
    const cell = ensure(r, c)
    if (!cell || widthOf(cell[side]) >= ln.widthPx) return
    cell[side] = `${ln.widthPx}px ${ln.style} ${ln.color}`
  }

  const xAt = (col: number, off: number): number => { let x = off; for (let c = 0; c < col; c++) x += colPx(sheet, c); return x }
  const yAt = (row: number, off: number): number => { let y = off; for (let r = 0; r < row; r++) y += rowPx(sheet, r); return y }

  for (const ln of lines) {
    const x1 = xAt(ln.fromCol, ln.fromColOffPx)
    const x2 = xAt(ln.toCol, ln.toColOffPx)
    const y1 = yAt(ln.fromRow, ln.fromRowOffPx)
    const y2 = yAt(ln.toRow, ln.toRowOffPx)
    if (Math.abs(y2 - y1) <= 6 && x2 - x1 > 6) {
      // 가로선 — 가장 가까운 행 경계(그 행의 위 또는 아래 테두리)
      const y = (y1 + y2) / 2
      let r = 0, y0 = 0
      while (r < rowCount - 1 && y0 + rowPx(sheet, r) <= y) { y0 += rowPx(sheet, r); r++ }
      const top = y - y0 <= rowPx(sheet, r) / 2
      let cx = 0
      for (let c = 0; c < colCount; c++) {
        const w = colPx(sheet, c)
        const overlap = Math.min(x2, cx + w) - Math.max(x1, cx)
        if (overlap >= Math.min(w, 20) * 0.5 && overlap > 0) setSide(r, c, top ? 'borderTop' : 'borderBottom', ln)
        cx += w
      }
    } else if (Math.abs(x2 - x1) <= 6 && y2 - y1 > 6) {
      // 세로선
      const x = (x1 + x2) / 2
      let c = 0, x0 = 0
      while (c < colCount - 1 && x0 + colPx(sheet, c) <= x) { x0 += colPx(sheet, c); c++ }
      const left = x - x0 <= colPx(sheet, c) / 2
      let cy = 0
      for (let r = 0; r < rowCount; r++) {
        const h = rowPx(sheet, r)
        const overlap = Math.min(y2, cy + h) - Math.max(y1, cy)
        if (overlap >= Math.min(h, 12) * 0.5 && overlap > 0) setSide(r, c, left ? 'borderLeft' : 'borderRight', ln)
        cy += h
      }
    }
  }
  return { ...sheet, cellFormatting: fmt }
}

/** 부가 정보를 문서에 반영한 새 문서(원본은 바꾸지 않는다) */
export function applyWorkbookExtras(doc: SpreadsheetDocument, extras: WorkbookExtras): SpreadsheetDocument {
  const sheets = doc.sheets.map((sheet) => {
    const ex = extras.get(sheet.name)
    if (!ex) return sheet
    let next: SpreadsheetSheet = { ...sheet }
    if (ex.hidden) next.hidden = true
    if (ex.freeze) next.freeze = ex.freeze
    if (ex.links.length) {
      const rows = sheet.rows.map((r) => [...r])
      for (const l of ex.links) {
        if (l.row >= rows.length || l.col >= (rows[l.row]?.length ?? 0)) continue
        const text = rows[l.row][l.col]
        const base = text !== '' ? text : l.display
        if (base === '') continue // 보일 글자가 없는 칸에는 링크를 달지 않는다
        rows[l.row][l.col] = `${base}${toLinkMarker(l.url)}`
      }
      next = { ...next, rows }
    }
    if (ex.lines.length) next = applyLinesToSheet(next, ex.lines)
    return next
  })
  // 처음 보이는 시트는 숨김이 아닌 첫 시트
  const firstVisible = sheets.findIndex((s) => !s.hidden)
  return { ...doc, sheets, activeSheetIndex: firstVisible >= 0 ? firstVisible : 0 }
}
