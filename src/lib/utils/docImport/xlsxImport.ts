/**
 * xlsxImport.ts — SheetJS 기반 .xlsx 시트 파싱 + TipTap 표 노드 변환
 *
 * 클라이언트 전용 (브라우저에서 SheetJS 실행).
 *
 * 병합 셀(`!merges`)·컬럼너비(`!cols`) 보존:
 *   SheetJS는 워크시트 병합 정보를 `ws['!merges']`(절대 좌표)로 별도 제공하는데,
 *   기존 구현은 이를 완전히 무시해 다단 헤더 등 병합된 표를 가져오면 병합됐던 칸이
 *   빈 셀/중복 셀로 쪼개져 나왔다 — parseSheet()가 선택 범위 기준 상대 좌표로 변환해
 *   반환하고, rowsToTiptapTable()이 이를 이용해 앵커 셀에 colspan/rowspan을 부여한다.
 *
 * 셀 배경색·테두리색(2026-08-15 추가):
 *   배경색은 `xlsx` 패키지가 `cellStyles:true`로 읽을 때 `cell.s.fgColor.rgb`로 이미
 *   제공한다(테마 색상도 resolve됨) — 그대로 사용.
 *   테두리색은 이 패키지의 공개 API가 전혀 제공하지 않는다(`xlsx.js` 소스 직접 확인 —
 *   `styles.Borders`를 내부적으로 파싱은 하지만 셀에 붙여주지 않음). docxTableFormatting.ts와
 *   동일한 방식(jszip + DOMParser로 OOXML 직접 읽기)으로 `xl/styles.xml`(borders·cellXfs)과
 *   워크시트 XML(셀별 style index `s` 속성)을 직접 파싱해 보완한다.
 */

import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import type { JSONContent } from '@tiptap/core'
// Types now live in sheet-format.ts — import here for use in this file and re-export for backward compat
import type { SheetMergeRange, XlsxCellFormatting } from '$lib/types/sheet-format'
import { fitColumnWidthsToTarget } from './fitColumnWidths'
import { readBiffWorkbookCached } from './xlsBiff'
import { tryParseFormula, usesOnlySupportedFunctions, KOREAN_BUILTIN_FORMATS } from '$lib/utils/sheetFormula'
export type { SheetMergeRange, XlsxCellFormatting } from '$lib/types/sheet-format'

// ─────────────────────────────────────────────────────────────────────────────
// 테두리색 직접 추출 (OOXML 원본 — xlsx 패키지가 노출하지 않는 정보)
// ─────────────────────────────────────────────────────────────────────────────

const SS_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'

/** OOXML 컬러 원시값(ARGB 8자리 또는 RGB 6자리) → CSS '#RRGGBB' */
function toHexColor(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined
  const digits = raw.replace(/[^0-9A-Fa-f]/g, '')
  if (digits.length < 6) return undefined
  return '#' + digits.slice(-6).toUpperCase()
}

/** 시트 이름으로 워크시트 XML의 zip 내부 경로를 찾는다(xl/workbook.xml + rels 경유) */
async function resolveWorksheetPath(zip: JSZip, sheetName: string): Promise<string | null> {
  const wbFile = zip.file('xl/workbook.xml')
  const relsFile = zip.file('xl/_rels/workbook.xml.rels')
  if (!wbFile || !relsFile) return null

  const parser = new DOMParser()
  const wbDoc = parser.parseFromString(await wbFile.async('string'), 'application/xml')
  const sheetEls = Array.from(wbDoc.getElementsByTagNameNS(SS_NS, 'sheet'))
  const target = sheetEls.find((el) => el.getAttribute('name') === sheetName)
  if (!target) return null
  const rId = target.getAttributeNS(REL_NS, 'id') ?? target.getAttribute('r:id')
  if (!rId) return null

  const relsDoc = parser.parseFromString(await relsFile.async('string'), 'application/xml')
  const relEls = Array.from(relsDoc.getElementsByTagNameNS(PKG_REL_NS, 'Relationship'))
  const rel = relEls.find((el) => el.getAttribute('Id') === rId)
  const relTarget = rel?.getAttribute('Target')
  if (!relTarget) return null
  return relTarget.startsWith('xl/') ? relTarget : `xl/${relTarget.replace(/^\.?\//, '')}`
}

/** xl/styles.xml에서 borderId별 대표 색상(top→left→bottom→right 순 첫 비-auto 색)과 cellXfs의 style-index→borderId 매핑을 추출 */
async function extractStylesInfo(
  zip: JSZip,
): Promise<{ borderColorById: (string | undefined)[]; cellXfBorderId: number[] } | null> {
  const stylesFile = zip.file('xl/styles.xml')
  if (!stylesFile) return null
  const parser = new DOMParser()
  const doc = parser.parseFromString(await stylesFile.async('string'), 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) return null

  const bordersEl = doc.getElementsByTagNameNS(SS_NS, 'borders')[0]
  const borderColorById: (string | undefined)[] = []
  if (bordersEl) {
    const borderEls = Array.from(bordersEl.children).filter((el) => el.localName === 'border')
    for (const b of borderEls) {
      let color: string | undefined
      for (const side of ['top', 'left', 'bottom', 'right']) {
        const sideEl = Array.from(b.children).find((el) => el.localName === side)
        if (!sideEl) continue
        const colorEl = Array.from(sideEl.children).find((el) => el.localName === 'color')
        const c = toHexColor(colorEl?.getAttribute('rgb'))
        if (c) { color = c; break }
      }
      borderColorById.push(color)
    }
  }

  const cellXfsEl = doc.getElementsByTagNameNS(SS_NS, 'cellXfs')[0]
  const cellXfBorderId: number[] = []
  if (cellXfsEl) {
    const xfEls = Array.from(cellXfsEl.children).filter((el) => el.localName === 'xf')
    for (const xf of xfEls) {
      const bId = parseInt(xf.getAttribute('borderId') ?? '0', 10)
      cellXfBorderId.push(isNaN(bId) ? 0 : bId)
    }
  }

  return { borderColorById, cellXfBorderId }
}

/** 워크시트 XML에서 셀 참조("A1") → style index(cellXfs 인덱스, `s` 속성) 맵을 추출 */
async function extractCellStyleIndices(zip: JSZip, worksheetPath: string): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  const wsFile = zip.file(worksheetPath)
  if (!wsFile) return map
  const parser = new DOMParser()
  const doc = parser.parseFromString(await wsFile.async('string'), 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) return map
  const cellEls = doc.getElementsByTagNameNS(SS_NS, 'c')
  for (let i = 0; i < cellEls.length; i++) {
    const c = cellEls[i]
    const ref = c.getAttribute('r')
    const s = c.getAttribute('s')
    if (!ref || !s) continue
    const idx = parseInt(s, 10)
    if (!isNaN(idx)) map.set(ref, idx)
  }
  return map
}

/**
 * 시트의 셀별 테두리색을 추출한다("A1" 등 절대 셀 참조 → CSS 색상 문자열 맵).
 * 개별 단계 중 하나라도 실패(파일 없음·파싱 에러 등)하면 빈 맵 반환 — 배경색·구조 데이터에는
 * 영향 없이 테두리색만 조용히 생략됨(정확성이 완결성보다 우선 — docxTableFormatting.ts와 동일 원칙).
 */
async function extractBorderColors(arrayBuffer: ArrayBuffer, sheetName: string): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  try {
    const zip = await JSZip.loadAsync(arrayBuffer)
    const wsPath = await resolveWorksheetPath(zip, sheetName)
    const stylesInfo = await extractStylesInfo(zip)
    if (!wsPath || !stylesInfo) return result
    const cellStyleIdx = await extractCellStyleIndices(zip, wsPath)

    for (const [ref, xfIdx] of cellStyleIdx) {
      const borderId = stylesInfo.cellXfBorderId[xfIdx]
      if (borderId === undefined) continue
      const color = stylesInfo.borderColorById[borderId]
      if (color) result.set(ref, color)
    }
  } catch {
    return new Map()
  }
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// 원본 배치 보존용 추출(preserveLayout) — 열 너비·행 높이·변별 테두리 (2026-10-29)
// ─────────────────────────────────────────────────────────────────────────────

/** 엑셀 열 너비(글자 수 단위, 여백 포함 저장값) → px. 기본 글꼴 최대 숫자 폭 7px 기준(엑셀 표준 8.43자 ≈ 64px) */
export const EXCEL_PX_PER_CHAR = 7
/** 열 정보가 없는 칸의 엑셀 기본 열 너비(px) */
export const EXCEL_DEFAULT_COL_PX = 64

/** 엑셀 pt → 화면 px (96dpi) */
export function excelPtToPx(pt: number): number {
  return Math.round((pt * 96) / 72)
}

const EXCEL_INDEXED_COLORS: Record<number, string> = {
  8: '#000000', 9: '#FFFFFF', 10: '#FF0000', 11: '#00FF00', 12: '#0000FF', 13: '#FFFF00', 14: '#FF00FF', 15: '#00FFFF',
  16: '#800000', 17: '#008000', 18: '#000080', 19: '#808000', 20: '#800080', 21: '#008080', 22: '#C0C0C0', 23: '#808080',
}

/** 엑셀 테두리 한 변(<left>/<top>/…) → CSS "Npx 스타일 색". 선이 없으면 undefined. 자동색·테마색은 검정으로 본다 */
function borderSideToCss(sideEl: Element | undefined): string | undefined {
  const style = sideEl?.getAttribute('style')
  if (!sideEl || !style || style === 'none') return undefined
  let width = 1
  let kind: 'solid' | 'dashed' | 'dotted' | 'double' = 'solid'
  if (style === 'medium' || style === 'mediumDashed' || style === 'mediumDashDot' || style === 'mediumDashDotDot' || style === 'slantDashDot') width = 2
  if (style === 'thick') width = 3
  if (style === 'double') { width = 3; kind = 'double' }
  if (/dashed|dashDot/i.test(style)) kind = 'dashed'
  if (style === 'dotted' || style === 'hair') kind = 'dotted'
  const colorEl = Array.from(sideEl.children).find((el) => el.localName === 'color')
  let color = toHexColor(colorEl?.getAttribute('rgb'))
  if (!color) {
    const idx = colorEl?.getAttribute('indexed')
    color = (idx !== null && idx !== undefined ? EXCEL_INDEXED_COLORS[parseInt(idx, 10)] : undefined) ?? '#000000'
  }
  return `${width}px ${kind} ${color}`
}

/** 글꼴 이름으로 허용하는 모양(글자·숫자·공백·_.-) — 스타일 문자열 주입 방지 */
const SAFE_FONT_NAME = /^[\p{L}\p{N} _.-]{1,40}$/u

export interface CellFont {
  name?: string
  sizePt?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  color?: string
}

const DML_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'

/** xl/theme/theme1.xml → 엑셀 테마 색 번호(0~11) 순서의 '#RRGGBB' 배열. (엑셀은 lt1·dk1·lt2·dk2·accent1~6·hlink·folHlink 순) */
async function readThemeColors(zip: JSZip): Promise<string[]> {
  const f = zip.file('xl/theme/theme1.xml')
  if (!f) return []
  const doc = new DOMParser().parseFromString(await f.async('string'), 'application/xml')
  const scheme = doc.getElementsByTagNameNS(DML_NS, 'clrScheme')[0]
  if (!scheme) return []
  const byName = new Map<string, string>()
  for (const el of Array.from(scheme.children)) {
    const c = Array.from(el.children)[0]
    const hex = toHexColor(c?.getAttribute('val') ?? c?.getAttribute('lastClr'))
    if (hex) byName.set(el.localName, hex)
  }
  return ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'].map((n) => byName.get(n) ?? '#000000')
}

/** 엑셀 색 밝기(tint, -1~1)를 RGB 에 적용 — 양수는 흰색 쪽, 음수는 검정 쪽으로 섞는다 */
function applyTint(hex: string, tint: number): string {
  if (!tint || !isFinite(tint)) return hex
  const n = parseInt(hex.slice(1), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(tint > 0 ? c + (255 - c) * tint : c * (1 + tint)))
  return '#' + ch.map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('').toUpperCase()
}

/** <color>/<fgColor> 요소 → '#RRGGBB'. 자동색·시스템색(indexed 64/65)은 undefined(= 기본색) */
function resolveColorEl(el: Element | undefined, theme: string[]): string | undefined {
  if (!el) return undefined
  const rgb = toHexColor(el.getAttribute('rgb'))
  if (rgb) return rgb
  const th = el.getAttribute('theme')
  if (th !== null) {
    const base = theme[parseInt(th, 10)]
    return base ? applyTint(base, parseFloat(el.getAttribute('tint') ?? '0')) : undefined
  }
  const idx = el.getAttribute('indexed')
  if (idx !== null) {
    const n = parseInt(idx, 10)
    return n === 64 || n === 65 ? undefined : EXCEL_INDEXED_COLORS[n]
  }
  return undefined
}

export interface CellAlign {
  horizontal?: 'left' | 'center' | 'right' | 'justify'
  vertical?: 'top' | 'middle' | 'bottom'
  wrap: boolean
}

export interface CellBorders {
  top?: string
  right?: string
  bottom?: string
  left?: string
}

interface SheetLayoutXml {
  borders: Map<string, CellBorders>
  /** 칸별 가로·세로 정렬과 자동 줄바꿈(엑셀 셀 서식의 <alignment>) */
  aligns: Map<string, CellAlign>
  /** 칸별 글꼴(이름·크기·굵기·기울임·밑줄·취소선·색) */
  fonts: Map<string, CellFont>
  /** 칸별 배경색(단색 채우기) */
  fills: Map<string, string>
  /** 칸별 내장 표시 형식 번호(numFmtId) — 라이브러리가 못 읽는 나라별 내장 서식(27~33)을 직접 풀기 위해 */
  numFmtIds: Map<string, number>
  /** 시트 기본 행 높이(px) — 행에 높이가 따로 없을 때 쓴다. 정보가 없으면 null */
  defaultRowPx: number | null
}

/** styles.xml 에서 borderId별 변(上右下左) CSS 와 cellXfs 의 style-index→borderId */
async function extractDetailedBorderStyles(
  zip: JSZip,
): Promise<{
  byBorderId: CellBorders[]
  cellXfBorderId: number[]
  cellXfAlign: CellAlign[]
  cellXfFont: CellFont[]
  cellXfFill: (string | undefined)[]
  cellXfNumFmtId: number[]
} | null> {
  const stylesFile = zip.file('xl/styles.xml')
  if (!stylesFile) return null
  const doc = new DOMParser().parseFromString(await stylesFile.async('string'), 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) return null
  const byBorderId: CellBorders[] = []
  const bordersEl = doc.getElementsByTagNameNS(SS_NS, 'borders')[0]
  if (bordersEl) {
    for (const b of Array.from(bordersEl.children).filter((el) => el.localName === 'border')) {
      const side = (name: string): Element | undefined => Array.from(b.children).find((el) => el.localName === name)
      byBorderId.push({
        top: borderSideToCss(side('top')),
        right: borderSideToCss(side('right')),
        bottom: borderSideToCss(side('bottom')),
        left: borderSideToCss(side('left')),
      })
    }
  }
  const theme = await readThemeColors(zip)
  const flag = (el: Element | undefined): boolean => !!el && !['0', 'false', 'none'].includes(el.getAttribute('val') ?? '')
  const fonts: CellFont[] = []
  const fontsEl = doc.getElementsByTagNameNS(SS_NS, 'fonts')[0]
  if (fontsEl) {
    for (const f of Array.from(fontsEl.children).filter((el) => el.localName === 'font')) {
      const kid = (n: string): Element | undefined => Array.from(f.children).find((el) => el.localName === n)
      const sz = parseFloat(kid('sz')?.getAttribute('val') ?? '')
      fonts.push({
        name: kid('name')?.getAttribute('val') ?? undefined,
        sizePt: Number.isFinite(sz) && sz > 0 ? sz : undefined,
        bold: flag(kid('b')),
        italic: flag(kid('i')),
        underline: flag(kid('u')),
        strike: flag(kid('strike')),
        color: resolveColorEl(kid('color'), theme),
      })
    }
  }
  const fills: (string | undefined)[] = []
  const fillsEl = doc.getElementsByTagNameNS(SS_NS, 'fills')[0]
  if (fillsEl) {
    for (const f of Array.from(fillsEl.children).filter((el) => el.localName === 'fill')) {
      const p = Array.from(f.children).find((el) => el.localName === 'patternFill')
      const solid = p?.getAttribute('patternType') === 'solid'
      fills.push(solid ? resolveColorEl(Array.from(p!.children).find((el) => el.localName === 'fgColor'), theme) : undefined)
    }
  }
  const cellXfBorderId: number[] = []
  const cellXfAlign: CellAlign[] = []
  const cellXfFont: CellFont[] = []
  const cellXfFill: (string | undefined)[] = []
  const cellXfNumFmtId: number[] = []
  const cellXfsEl = doc.getElementsByTagNameNS(SS_NS, 'cellXfs')[0]
  if (cellXfsEl) {
    for (const xf of Array.from(cellXfsEl.children).filter((el) => el.localName === 'xf')) {
      const id = parseInt(xf.getAttribute('borderId') ?? '0', 10)
      cellXfBorderId.push(isNaN(id) ? 0 : id)
      cellXfNumFmtId.push(parseInt(xf.getAttribute('numFmtId') ?? '0', 10) || 0)
      cellXfFont.push(fonts[parseInt(xf.getAttribute('fontId') ?? '0', 10)] ?? {})
      cellXfFill.push(fills[parseInt(xf.getAttribute('fillId') ?? '0', 10)])
      const al = Array.from(xf.children).find((el) => el.localName === 'alignment')
      const h = al?.getAttribute('horizontal') ?? ''
      const v = al?.getAttribute('vertical') ?? ''
      cellXfAlign.push({
        horizontal:
          h === 'left' ? 'left'
          : h === 'center' || h === 'centerContinuous' ? 'center'
          : h === 'right' ? 'right'
          : h === 'justify' || h === 'distributed' || h === 'fill' ? 'justify'
          : undefined, // general(기본) — 글자는 왼쪽·숫자는 오른쪽(가져올 때 값을 보고 정한다)
        vertical: v === 'top' ? 'top' : v === 'center' || v === 'distributed' || v === 'justify' ? 'middle' : v === 'bottom' ? 'bottom' : undefined,
        wrap: al?.getAttribute('wrapText') === '1' || al?.getAttribute('wrapText') === 'true',
      })
    }
  }
  return { byBorderId, cellXfBorderId, cellXfAlign, cellXfFont, cellXfFill, cellXfNumFmtId }
}

/** 시트의 셀별 테두리(변별)와 기본 행 높이 — 실패하면 빈 값(서식만 조용히 생략, 값·구조는 영향 없음) */
async function extractSheetLayoutXml(arrayBuffer: ArrayBuffer, sheetName: string): Promise<SheetLayoutXml> {
  const empty: SheetLayoutXml = { borders: new Map(), aligns: new Map(), fonts: new Map(), fills: new Map(), numFmtIds: new Map(), defaultRowPx: null }
  try {
    const zip = await JSZip.loadAsync(arrayBuffer)
    const wsPath = await resolveWorksheetPath(zip, sheetName)
    const styles = await extractDetailedBorderStyles(zip)
    if (!wsPath) return empty
    const wsFile = zip.file(wsPath)
    if (!wsFile) return empty
    const doc = new DOMParser().parseFromString(await wsFile.async('string'), 'application/xml')
    if (doc.getElementsByTagName('parsererror').length) return empty

    const fmtEl = doc.getElementsByTagNameNS(SS_NS, 'sheetFormatPr')[0]
    const defPt = parseFloat(fmtEl?.getAttribute('defaultRowHeight') ?? '')
    const defaultRowPx = Number.isFinite(defPt) && defPt > 0 ? excelPtToPx(defPt) : null

    const borders = new Map<string, CellBorders>()
    const aligns = new Map<string, CellAlign>()
    const fonts = new Map<string, CellFont>()
    const fills = new Map<string, string>()
    const numFmtIds = new Map<string, number>()
    if (styles) {
      const cellEls = doc.getElementsByTagNameNS(SS_NS, 'c')
      for (let i = 0; i < cellEls.length; i++) {
        const ref = cellEls[i].getAttribute('r')
        // 서식 번호가 없는 칸은 기본 서식(0번)
        const s = parseInt(cellEls[i].getAttribute('s') ?? '0', 10)
        if (!ref || isNaN(s)) continue
        const b = styles.byBorderId[styles.cellXfBorderId[s] ?? -1]
        if (b && (b.top || b.right || b.bottom || b.left)) borders.set(ref, b)
        const a = styles.cellXfAlign[s]
        if (a) aligns.set(ref, a)
        const fo = styles.cellXfFont[s]
        if (fo) fonts.set(ref, fo)
        const fi = styles.cellXfFill[s]
        if (fi) fills.set(ref, fi)
        const nf = styles.cellXfNumFmtId[s]
        if (nf) numFmtIds.set(ref, nf)
      }
    }
    return { borders, aligns, fonts, fills, numFmtIds, defaultRowPx }
  } catch {
    return empty
  }
}

export interface XlsxSheetInfo {
  name: string
}

export interface XlsxImportOptions {
  /** 파싱할 시트 이름 */
  sheetName: string
  /**
   * 범위 (e.g., 'A1:D10'). 미지정 시 시트 전체 범위.
   * 행수가 100을 넘으면 서버 응답 지연을 유발할 수 있으므로 UI에서 제한.
   */
  range?: string
  /**
   * 원본 배치 보존(스프레드시트 양식 가져오기 전용, 2026-10-29) — 켜면:
   *  · 열 너비를 파일의 글자 수 값(×7px)으로 직접 환산하고 A4 폭 자동 축소를 하지 않는다
   *  · 병합에 걸치지 않은 빈 행도 지우지 않는다(원본 여백·세로 구조 유지)
   *  · 행 높이를 가져온다
   *  · 테두리를 변별 굵기·종류·색(자동색 포함)으로 가져온다
   * 끄면(기본) 문서형 표 가져오기가 쓰는 기존 동작 그대로.
   */
  preserveLayout?: boolean
}

export interface XlsxSheetData {
  /** 2D 문자열 배열 (첫 행 = 헤더 가정) — 병합에 걸치지 않은 완전 빈 행은 제거됨 */
  rows: string[][]
  /** 선택 범위 기준 상대 좌표로 변환된 병합 범위 목록(제거된 빈 행 반영해 재인덱싱됨) */
  merges: SheetMergeRange[]
  /** 컬럼별 너비(px). 정보 없는 컬럼은 null */
  colWidths: (number | null)[]
  /** [rowIndex][colIndex] 형태의 셀 서식(배경색·테두리색). rows와 동일 인덱스로 정렬됨 */
  cellFormatting: XlsxCellFormatting[][]
  /** 행별 높이(px) — preserveLayout 일 때만 채워지고 rows 와 같은 인덱스. 아니면 빈 배열 */
  rowHeights: (number | null)[]
  /** 수식 칸의 수식 원문(칸 주소 "C1" → "=A1+B1", 시트 기준 상대 좌표) — preserveLayout 일 때만 */
  formulas?: Record<string, string>
  /** 수식 칸의 표시 형식 코드 — preserveLayout 일 때만 */
  numFmts?: Record<string, string>
}

/**
 * File 객체에서 XLSX Workbook을 로드하고 시트 목록을 반환한다.
 */
export async function getSheetNames(file: File): Promise<XlsxSheetInfo[]> {
  const arrayBuffer = await file.arrayBuffer()
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  return wb.SheetNames.map((name) => ({ name }))
}

/**
 * 특정 시트를 파싱해 2D 문자열 배열 + 병합 범위 + 컬럼너비를 반환한다.
 */
export async function parseSheet(
  file: File,
  options: XlsxImportOptions
): Promise<XlsxSheetData> {
  const arrayBuffer = await file.arrayBuffer()
  // cellStyles:true — 기본값으로는 !cols(컬럼너비) 정보가 읽히지 않음(SheetJS 기본 동작)
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellStyles: true })

  const ws = wb.Sheets[options.sheetName]
  if (!ws) throw new Error(`시트 "${options.sheetName}"를 찾을 수 없습니다.`)
  const preserve = options.preserveLayout === true

  // blankrows 옵션을 주지 않는다(기본값 = 빈 행도 포함) — 병합 좌표(!merges, 절대 시트 행
  // 인덱스 기준)를 항상 fullRows와 1:1로 정렬시키기 위해 필수. 실무 문서(계약서 등)는 시각적
  // 여백을 위한 완전 빈 행이 흔한데, blankrows:false로 먼저 제거해버리면 그 이후 모든 행의
  // 인덱스가 어긋나 병합 좌표 변환이 통째로 부정확해진다 — 과거엔 이걸 감지해 병합 정보 전체를
  // 비우는 안전장치를 뒀으나(2026-08-14 최초 구현), 여백 행이 있는 흔한 문서에서 병합이 전부
  // 무시되는 결과로 이어져(실사용 중 발견) 아래처럼 "병합에 걸치지 않은 빈 행만" 직접 골라
  // 제거하는 방식으로 교체했다.
  const opts: XLSX.Sheet2JSONOpts = {
    header: 1,       // 2D 배열 반환
    defval: '',      // 빈 셀 → 빈 문자열
    // raw:false — 기본값(raw:true)은 셀의 서식 적용 전 원시값을 반환해 통화·날짜·백분율처럼
    // 서식이 입혀진 셀이 "1200000"(₩1,200,000 대신)이나 날짜 일련번호(2026-08-15 대신
    // 46249 같은 숫자)로 깨져 나온다 — raw:false는 SheetJS가 셀 서식(numFmt)을 적용해
    // 계산한 표시 텍스트를 그대로 반환하게 한다(실사용 중 발견 — 실제 계약서 스프레드시트는
    // 금액·날짜 서식 셀이 흔함).
    raw: false,
    ...(options.range ? { range: options.range } : {}),
  }

  const fullRawRows = XLSX.utils.sheet_to_json<string[]>(ws, opts)
  // 모든 셀을 문자열로 변환 (숫자·날짜 등 포함) — 시트 행 인덱스와 1:1 정렬된 상태
  const fullRows = fullRawRows.map((row) => row.map((cell) => (cell == null ? '' : String(cell))))

  // 선택 범위(없으면 시트 전체 사용 범위)의 좌상단을 병합 좌표 변환 기준으로 사용
  const effectiveRange = options.range
    ? XLSX.utils.decode_range(options.range)
    : ws['!ref']
      ? XLSX.utils.decode_range(ws['!ref'])
      : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }

  const rawMerges = (ws['!merges'] ?? []) as SheetMergeRange[]
  // fullRows는 시트 행과 1:1 정렬돼 있으므로 이 시점의 좌표 변환은 항상 정확함
  const fullMerges: SheetMergeRange[] = rawMerges
    // 선택 범위를 완전히 벗어나는 병합은 제외(부분적으로 걸치는 경우도 안전하게 스킵)
    .filter(
      (m) =>
        m.s.r >= effectiveRange.s.r && m.e.r <= effectiveRange.e.r &&
        m.s.c >= effectiveRange.s.c && m.e.c <= effectiveRange.e.c &&
        m.e.r >= m.s.r && m.e.c >= m.s.c,
    )
    .map((m) => ({
      s: { r: m.s.r - effectiveRange.s.r, c: m.s.c - effectiveRange.s.c },
      e: { r: m.e.r - effectiveRange.s.r, c: m.e.c - effectiveRange.s.c },
    }))
    .filter((m) => m.e.r < fullRows.length && m.e.c < (fullRows[0]?.length ?? 0))

  // 병합이 걸쳐있는 행 인덱스 집합 — 이 행들은 셀 텍스트가 비어 있어도 제거하면 안 됨
  // (제거하면 그 병합의 rowspan이 가리키는 실제 물리적 행 수가 어긋난다)
  const rowsTouchedByMerge = new Set<number>()
  for (const m of fullMerges) {
    for (let r = m.s.r; r <= m.e.r; r++) rowsTouchedByMerge.add(r)
  }

  const isBlankRow = (row: string[]): boolean => row.every((c) => c === '')

  // 빈 행 제거 — 병합에 걸치지 않은 완전 빈 행만 제거(레이아웃 여백 행 정리).
  // 제거로 인한 행 인덱스 이동을 병합 좌표에도 함께 반영해야 하므로 이전→이후 매핑을 구성.
  // keptOldRowIndices: 최종 rows[i]가 원래 시트의 몇 번째 행이었는지(서식 조회용 역참조)
  const oldToNewRowIndex = new Map<number, number>()
  const rows: string[][] = []
  const keptOldRowIndices: number[] = []
  fullRows.forEach((row, oldIdx) => {
    if (!preserve && isBlankRow(row) && !rowsTouchedByMerge.has(oldIdx)) return // 제거(원본 배치 보존 시에는 유지)
    oldToNewRowIndex.set(oldIdx, rows.length)
    rows.push(row)
    keptOldRowIndices.push(oldIdx)
  })

  // 병합 좌표를 최종 rows 배열의 행 인덱스로 재매핑
  const merges: SheetMergeRange[] = fullMerges.reduce<SheetMergeRange[]>((acc, m) => {
    const newS = oldToNewRowIndex.get(m.s.r)
    const newE = oldToNewRowIndex.get(m.e.r)
    // rowsTouchedByMerge 덕에 병합이 걸친 행은 항상 매핑에 존재해야 하나, 방어적으로 확인
    if (newS === undefined || newE === undefined) return acc
    acc.push({ s: { r: newS, c: m.s.c }, e: { r: newE, c: m.e.c } })
    return acc
  }, [])

  const colCount = rows[0]?.length ?? 0
  const rawColWidths: (number | null)[] = Array.from({ length: colCount }, (_, ci) => {
    const col = ws['!cols']?.[effectiveRange.s.c + ci]
    if (preserve) {
      // 라이브러리의 wpx 는 한글 기본 글꼴(돋움 등)의 글자 폭을 몰라 글자당 12px 안팎으로 부풀린다 — 파일의 글자 수 값으로 직접 환산
      const chars = col?.width
      if (col?.hidden) return 0
      return typeof chars === 'number' && chars > 0 ? Math.round(chars * EXCEL_PX_PER_CHAR) : EXCEL_DEFAULT_COL_PX
    }
    const px = col?.wpx
    return typeof px === 'number' && px > 0 ? Math.round(px) : null
  })

  // Excel은 사용자가 직접 폭을 조정한 컬럼만 !cols에 기록한다 — 기본 폭 그대로인 컬럼은
  // 항목 자체가 없어(null) 위 배열에 구멍이 뚫린다. 정교하게 그려진 실무 표(예: 34개 컬럼짜리
  // 계약서 그리드)는 대부분의 컬럼이 이 "기본폭" 상태라, null을 그대로 두면
  // fitColumnWidthsToTarget()이 이 컬럼들의 존재 자체를 모른 채 알려진 몇 개만 축소하고,
  // TipTap은 결국 알려지지 않은 나머지 컬럼에 자체 최소폭(기본 25px)을 적용해버려 —
  // 컬럼 수가 많으면(예: 34 × 25px ≈ 850px) 축소 계산과 무관하게 A4 폭을 넘는 표가
  // 그대로 렌더링되는 결과로 이어졌다(2026-08-15 실사용 중 발견 — 34열 실제 계약서 표에서
  // colwidth가 대부분 0으로 채워지는 것으로 확인). null을 알려진 폭들의 평균(알려진 값이
  // 하나도 없으면 60px 기본값)으로 미리 채워 넣어, 축소 계산이 표의 "실제 전체 폭"을
  // 정확히 인식하도록 한다.
  const knownWidths = rawColWidths.filter((w): w is number => typeof w === 'number')
  const fallbackWidth = knownWidths.length > 0
    ? Math.round(knownWidths.reduce((a, b) => a + b, 0) / knownWidths.length)
    : 60
  const filledColWidths: (number | null)[] = rawColWidths.map((w) => w ?? fallbackWidth)

  // A4 폭(642px) 자동축소는 가져오기(import) 시점에 딱 1회만 적용한다 — 에디터가 열릴
  // 때마다(sheetToWorksheetConfig) 다시 적용하면 관리자가 그 이후 직접 넓힌 값이 재오픈
  // 시 매번 되돌아가는 문제가 있었다(2026-08-27 발견). 여기서 축소해 SpreadsheetSheet에
  // 담아 반환하면, 이후 저장·재오픈은 이 값을 그대로 유지한다.
  const colWidths: (number | null)[] = preserve ? rawColWidths : fitColumnWidthsToTarget(filledColWidths)

  // 셀 서식 — 배경색은 ws[addr].s.fgColor.rgb(SheetJS cellStyles:true로 이미 읽힘,
  // 테마 색상도 resolve됨), 테두리색은 OOXML 직접 파싱(extractBorderColors)으로 보완
  const borderColors = preserve ? new Map<string, string>() : await extractBorderColors(arrayBuffer, options.sheetName)
  // 구형 엑셀(.xls)은 압축 XML 이 아니라 바이너리 — 같은 모양의 서식 정보를 xlsBiff 가 직접 읽어 준다
  const biffLayout = preserve ? readBiffWorkbookCached(arrayBuffer)?.layoutBySheet.get(options.sheetName) : undefined
  const layoutXml: SheetLayoutXml = preserve
    ? biffLayout
      ? { ...biffLayout, numFmtIds: new Map() }
      : await extractSheetLayoutXml(arrayBuffer, options.sheetName)
    : { borders: new Map(), aligns: new Map(), fonts: new Map(), fills: new Map(), numFmtIds: new Map(), defaultRowPx: null }
  // 병합 셀은 화면에 앵커 칸만 그려지므로, 엑셀이 병합 범위 가장자리 칸들에 나눠 둔 테두리를 앵커로 모은다
  const anchorBorders = new Map<string, CellBorders>()
  if (preserve) {
    const at = (r: number, c: number): CellBorders | undefined => layoutXml.borders.get(XLSX.utils.encode_cell({ r, c }))
    for (const m of rawMerges) {
      const tl = at(m.s.r, m.s.c)
      const bl = at(m.e.r, m.s.c)
      const tr = at(m.s.r, m.e.c)
      anchorBorders.set(XLSX.utils.encode_cell(m.s), { top: tl?.top, left: tl?.left, bottom: bl?.bottom, right: tr?.right })
    }
  }
  const cellFormatting: XlsxCellFormatting[][] = rows.map((row, newRi) => {
    const oldRi = keptOldRowIndices[newRi]
    return row.map((_cellText, ci) => {
      const addr = XLSX.utils.encode_cell({ r: effectiveRange.s.r + oldRi, c: effectiveRange.s.c + ci })
      const fmt: XlsxCellFormatting = {}
      const bg = ws[addr]?.s?.fgColor?.rgb
      if (typeof bg === 'string' && bg) fmt.backgroundColor = toHexColor(bg)
      const border = borderColors.get(addr)
      if (border) fmt.borderColor = border
      if (preserve) {
        const sides = anchorBorders.get(addr) ?? layoutXml.borders.get(addr)
        if (sides?.top) fmt.borderTop = sides.top
        if (sides?.right) fmt.borderRight = sides.right
        if (sides?.bottom) fmt.borderBottom = sides.bottom
        if (sides?.left) fmt.borderLeft = sides.left
        // 정렬·줄바꿈 — 글이 있는 칸만. 정렬 없음(general)은 엑셀처럼 글자 왼쪽·숫자 오른쪽,
        // 세로는 엑셀 기본(아래). 편집기 기본이 가운데 정렬이라 명시하지 않으면 원본과 달라진다
        if (_cellText.trim() !== '') {
          const al = layoutXml.aligns.get(addr)
          fmt.textAlign = al?.horizontal ?? (/^[\d,.\-+%₩$\s()]+$/.test(_cellText) ? 'right' : 'left')
          fmt.verticalAlign = al?.vertical ?? 'bottom'
          if (!al?.wrap) fmt.wrapText = false
          // 글꼴 — 이름·크기(pt)·굵기·기울임·밑줄·취소선·색. 편집기·고객 화면이 받는 안전한 값만 쓴다
          const fo = layoutXml.fonts.get(addr)
          if (fo) {
            if (fo.name && SAFE_FONT_NAME.test(fo.name)) fmt.fontFamily = fo.name
            if (fo.sizePt) fmt.fontSize = `${Math.round(fo.sizePt * 2) / 2}pt`
            if (fo.bold) fmt.fontWeight = 'bold'
            if (fo.italic) fmt.fontStyle = 'italic'
            if (fo.underline || fo.strike) fmt.textDecoration = [fo.underline ? 'underline' : '', fo.strike ? 'line-through' : ''].filter(Boolean).join(' ')
            if (fo.color) fmt.color = fo.color
          }
        }
        // 배경색 — SheetJS 가 못 읽은 경우(테마색·색인색)를 파일에서 직접 보충
        if (!fmt.backgroundColor) {
          const fill = layoutXml.fills.get(addr)
          if (fill) fmt.backgroundColor = fill
        }
      }
      // 폰트 서식(2026-08-20 추가) — SheetJS CE의 cellStyles:true가 폰트 정보까지 채워주는
      // 파일에서는 그대로 활용하고, 채워주지 않는 파일에서는 옵셔널 체이닝으로 조용히 undefined
      // 처리된다(가져오기 자체가 깨지지 않음 — best-effort).
      const font = ws[addr]?.s?.font as { color?: { rgb?: string }; bold?: boolean; sz?: number } | undefined
      const fontColor = font?.color?.rgb
      if (typeof fontColor === 'string' && fontColor) fmt.color = toHexColor(fontColor)
      if (font?.bold === true) fmt.fontWeight = 'bold'
      if (typeof font?.sz === 'number' && font.sz > 0) fmt.fontSize = `${font.sz}pt`
      return fmt
    })
  })

  // 행 높이 — 파일에 높이가 없는 행은 시트 기본 행 높이를 쓴다(그것도 없으면 null = 편집기 기본)
  const rowHeights: (number | null)[] = preserve
    ? keptOldRowIndices.map((oldRi) => {
        const hpt = ws['!rows']?.[effectiveRange.s.r + oldRi]?.hpt
        return typeof hpt === 'number' && hpt > 0 ? excelPtToPx(hpt) : layoutXml.defaultRowPx
      })
    : []

  // 수식 — 값은 이미 rows 에 "엑셀이 계산해 둔 값"으로 들어 있다. 여기서는 수식 원문과 표시 형식을 함께 가져와, 편집기에서 시트 간 연결이
  // 계속 계산되게 한다. 이 엔진이 읽지 못하는 수식(지원하지 않는 함수·외부 통합 문서·열 전체 참조 등)은 가져오지 않고 값만 둔다.
  let formulas: Record<string, string> | undefined
  let numFmts: Record<string, string> | undefined
  if (preserve) {
    const covered = new Set<string>()
    for (const m of merges) for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) if (!(r === m.s.r && c === m.s.c)) covered.add(`${r}:${c}`)
    rows.forEach((row, newRi) => {
      const oldRi = keptOldRowIndices[newRi]
      row.forEach((_t, ci) => {
        if (covered.has(`${newRi}:${ci}`)) return // 병합에 가려진 칸의 수식은 화면에 보이지 않는다
        const abs = XLSX.utils.encode_cell({ r: effectiveRange.s.r + oldRi, c: effectiveRange.s.c + ci })
        const cell = ws[abs] as { f?: string; z?: string } | undefined
        const f = cell?.f
        if (typeof f !== 'string' || f.trim() === '') return
        const text = `=${f}`
        const ast = tryParseFormula(text)
        if (!ast || !usesOnlySupportedFunctions(ast)) return
        const addr = XLSX.utils.encode_cell({ r: newRi, c: ci })
        ;(formulas ??= {})[addr] = text
        const builtin = layoutXml.numFmtIds.get(abs)
        // 나라별로 달라지는 내장 서식(27~33)은 라이브러리가 미국식(m/d/yy)으로 풀어 버리므로 한국어 서식을 먼저 쓴다
        const koreanBuiltin = builtin !== undefined ? KOREAN_BUILTIN_FORMATS[builtin] : undefined
        const code = koreanBuiltin ?? (cell?.z && cell.z !== 'General' ? cell.z : undefined)
        if (code) (numFmts ??= {})[addr] = code
      })
    })
  }

  return { rows, merges, colWidths, cellFormatting, rowHeights, ...(formulas ? { formulas } : {}), ...(numFmts ? { numFmts } : {}) }
}

export interface MergeLayout {
  /** `"row:col"` → 병합에 덮여 노드를 만들지 않아야 하는 셀 집합 */
  coveredCells: Set<string>
  /** `"row:col"` → 그 셀이 병합 앵커일 때의 rowspan/colspan */
  anchorSpan: Map<string, { rowspan: number; colspan: number }>
}

/**
 * 병합 범위 목록으로부터 "덮인 셀" 집합과 "앵커 셀 span" 맵을 계산한다.
 * rowsToTiptapTable()(실제 삽입)과 ContractImportModal.svelte의 xlsx 미리보기 렌더링이
 * 동일 로직을 공유해 "미리보기에는 병합이 안 보이는데 실제 삽입 결과는 다름" 같은 불일치를
 * 방지한다(2026-08-14 실사용 중 발견 — 미리보기가 병합을 반영하지 않아 셀이 대량으로
 * 비어보여 "셀 유실"로 오인됨. 데이터 자체는 항상 앵커 셀에만 저장돼 있었음).
 */
export function computeMergeLayout(merges: SheetMergeRange[]): MergeLayout {
  const coveredCells = new Set<string>()
  const anchorSpan = new Map<string, { rowspan: number; colspan: number }>()

  for (const m of merges) {
    if (m.e.r < m.s.r || m.e.c < m.s.c || m.s.r < 0 || m.s.c < 0) continue
    anchorSpan.set(`${m.s.r}:${m.s.c}`, {
      rowspan: m.e.r - m.s.r + 1,
      colspan: m.e.c - m.s.c + 1,
    })
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        if (r === m.s.r && c === m.s.c) continue // 앵커 자신 제외
        coveredCells.add(`${r}:${c}`)
      }
    }
  }

  return { coveredCells, anchorSpan }
}

/**
 * 2D 문자열 배열을 TipTap 테이블 JSONContent 노드로 변환한다.
 * 첫 번째 행은 tableHeader 셀로, 나머지는 tableCell 로 처리한다.
 * 병합 범위(merges)가 있으면 앵커(좌상단) 셀에만 노드를 만들고 rowspan/colspan을 부여하며,
 * 병합에 덮인 나머지 셀은 노드 생성을 스킵한다. colWidths가 있으면 colwidth 속성도 부여한다.
 *
 * @param rows           - 2D 문자열 배열 (첫 행 = 헤더 가정)
 * @param merges         - parseSheet()가 반환한 상대 좌표 병합 범위(선택)
 * @param colWidths      - parseSheet()가 반환한 컬럼별 너비(px, 선택)
 * @param cellFormatting - parseSheet()가 반환한 [rowIndex][colIndex] 서식(배경색·테두리색, 선택)
 */
export function rowsToTiptapTable(
  rows: string[][],
  merges: SheetMergeRange[] = [],
  colWidths: (number | null)[] = [],
  cellFormatting: XlsxCellFormatting[][] = [],
): JSONContent {
  if (rows.length === 0) {
    throw new Error('변환할 데이터가 없습니다.')
  }

  const { coveredCells, anchorSpan } = computeMergeLayout(merges)

  const tiptapRows: JSONContent[] = []

  rows.forEach((row, rowIdx) => {
    const isHeader = rowIdx === 0
    const cells: JSONContent[] = []

    row.forEach((cellText, colIdx) => {
      const key = `${rowIdx}:${colIdx}`
      if (coveredCells.has(key)) return // 병합에 덮인 셀 — 스킵(중복 노드 방지)

      const span = anchorSpan.get(key)
      const attrs: Record<string, unknown> = {}
      if (span && span.rowspan > 1) attrs['rowspan'] = span.rowspan
      if (span && span.colspan > 1) attrs['colspan'] = span.colspan

      if (colWidths.length > 0) {
        const n = span?.colspan ?? 1
        const widths = Array.from({ length: n }, (_, i) => colWidths[colIdx + i])
        if (widths.some((w) => typeof w === 'number' && w > 0)) {
          attrs['colwidth'] = widths.map((w) => (typeof w === 'number' && w > 0 ? w : 0))
        }
      }

      const fmt = cellFormatting[rowIdx]?.[colIdx]
      if (fmt?.backgroundColor) attrs['backgroundColor'] = fmt.backgroundColor
      if (fmt?.borderColor) attrs['borderColor'] = fmt.borderColor

      cells.push({
        type: isHeader ? 'tableHeader' : 'tableCell',
        attrs,
        content: [
          {
            type: 'paragraph',
            content: cellText
              ? [{ type: 'text', text: cellText }]
              : [],
          },
        ],
      })
    })

    // 이 행의 모든 셀이 위쪽 세로병합에 흡수됐다면(가로 방향 병합이 전체를 뒤덮는 경우)
    // 빈 <tr>을 만들지 않고 행 자체를 건너뛴다 — TipTap tableRow는 최소 1개 셀이 필요하고,
    // 시각적으로도 빈 행을 추가하는 것보다 자연스럽다.
    if (cells.length === 0) return

    tiptapRows.push({
      type: 'tableRow',
      content: cells,
    })
  })

  return {
    type: 'table',
    content: tiptapRows,
  }
}
