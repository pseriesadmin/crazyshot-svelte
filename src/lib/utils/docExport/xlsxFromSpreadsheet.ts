/**
 * xlsxFromSpreadsheet.ts — 스프레드시트형 계약서 양식 → 엑셀(.xlsx) 파일 만들기 (브라우저 전용, 2026-10-29)
 *
 * SheetJS 무료판은 셀 서식(색·글꼴·테두리)을 쓸 수 없어 exceljs(지연 로딩)로 만든다.
 * 담는 것: 시트 이름·값·병합·열 너비, 셀 서식(배경·글자색·굵게·크기·글꼴·가로/세로 정렬·테두리).
 * 담지 않는 것: 서명·직인 이미지 겹침(글자만 남김), 반복 영역 설정, 행 높이(편집기가 저장하지 않음).
 * 값은 전부 글자로 쓴다 — 전화번호 앞자리 0·"=로 시작하는 글자"가 엑셀에서 숫자·수식으로 바뀌어 깨지지 않게 하기 위함.
 * `{{변수}}`는 그대로 남는다(양식 사본).
 */
import type { Alignment, Border, BorderStyle, Borders, Fill, Font } from 'exceljs'
import type { SpreadsheetDocument, SpreadsheetSheet } from '$lib/types/contract-document'
import { cellAddress, hasImageOverlay, splitCellImageOverlay, splitCellLink, type XlsxCellFormatting } from '$lib/types/sheet-format'

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** 엑셀 한 셀에 담을 수 있는 최대 글자 수 */
const MAX_CELL_CHARS = 32767
/** 엑셀 시트 이름 최대 길이 */
const MAX_SHEET_NAME = 31

export interface XlsxBuildResult {
  blob: Blob
  /** 사용자에게 알릴 주의(내용 손실 등) */
  warnings: string[]
}

// ───────────────────────────── 수식 ─────────────────────────────

/** 엑셀 파일에 수식으로 써도 안전한 모양만 허용 — 잘못된 수식은 엑셀이 "파일 복구"를 요구하므로, 확신 없으면 계산된 값만 쓴다 */
const SAFE_FORMULA = /^=[A-Za-z0-9_$.,:+\-*/^%()<>=&" ]+$/
/** 외부 접속·실행 성격의 엑셀 함수는 파일에 수식으로 넣지 않는다 */
const BLOCKED_FUNCTIONS = /\b(WEBSERVICE|HYPERLINK|CALL|REGISTER|EXEC|RTD|DDE|FILTERXML|INDIRECT)\s*\(/i

/** 편집기 수식 원문("=A1+B1") → 엑셀 수식("A1+B1"). 안전하지 않으면 null */
export function toExcelFormula(raw: string): string | null {
  if (raw.length < 2 || raw.length > 4000 || !SAFE_FORMULA.test(raw) || BLOCKED_FUNCTIONS.test(raw)) return null
  let depth = 0
  for (const ch of raw) {
    if (ch === '(') depth++
    if (ch === ')' && --depth < 0) return null
  }
  if (depth !== 0 || (raw.match(/"/g) ?? []).length % 2 !== 0) return null
  return raw.slice(1)
}

// ───────────────────────────── 값 변환 ─────────────────────────────

/** 엑셀이 거절하는 시트 이름 글자를 바꾸고, 비거나 겹치면 번호를 붙인다 */
export function toSafeSheetNames(names: string[]): string[] {
  const used = new Set<string>()
  return names.map((raw, i) => {
    let base = String(raw ?? '').replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '')
    if (!base) base = `Sheet${i + 1}`
    base = [...base].slice(0, MAX_SHEET_NAME).join('')
    let name = base
    let n = 2
    while (used.has(name.toLowerCase())) {
      const suffix = ` (${n++})`
      name = [...base].slice(0, MAX_SHEET_NAME - suffix.length).join('') + suffix
    }
    used.add(name.toLowerCase())
    return name
  })
}

/** 셀 값 → 엑셀에 쓸 글자. 이미지 겹침 표식은 떼어내고, 제어문자는 지운다 */
export function toCellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  let text = String(value)
  if (hasImageOverlay(text)) text = splitCellImageOverlay(text).text
  text = splitCellLink(text).text
  // XML 1.0 이 허용하지 않는 제어문자(탭·줄바꿈 제외)는 파일을 깨뜨린다
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  return text.length > MAX_CELL_CHARS ? text.slice(0, MAX_CELL_CHARS) : text
}

// ───────────────────────────── 서식 변환 ─────────────────────────────

/** '#RRGGBB' / '#RGB' / 'rgb(r, g, b)' / 'rgba(...)' → 엑셀 ARGB('FFRRGGBB'). 해석 불가·투명이면 undefined */
export function cssColorToArgb(css: string | undefined): string | undefined {
  if (!css) return undefined
  const v = css.trim()
  const hex6 = /^#([0-9a-f]{6})$/i.exec(v)
  if (hex6) return `FF${hex6[1].toUpperCase()}`
  const hex3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v)
  if (hex3) return `FF${hex3[1]}${hex3[1]}${hex3[2]}${hex3[2]}${hex3[3]}${hex3[3]}`.toUpperCase()
  const rgb = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(v)
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : parseFloat(rgb[4])
    if (alpha === 0) return undefined
    const h = (n: string) => Math.min(255, parseInt(n, 10)).toString(16).padStart(2, '0')
    return `FF${h(rgb[1])}${h(rgb[2])}${h(rgb[3])}`.toUpperCase()
  }
  return undefined
}

/** 편집기 툴바의 글자 크기 키워드와 'Npt' / 'Npx' → 엑셀 pt 크기 */
const FONT_KEYWORD_PT: Record<string, number> = {
  'xx-small': 7, 'x-small': 8, small: 10, medium: 12, large: 14, 'x-large': 18, 'xx-large': 24,
}
export function cssFontSizeToPt(css: string | undefined): number | undefined {
  if (!css) return undefined
  const v = css.trim().toLowerCase()
  if (v in FONT_KEYWORD_PT) return FONT_KEYWORD_PT[v]
  const m = /^(\d+(?:\.\d+)?)(pt|px)$/.exec(v)
  if (!m) return undefined
  const pt = m[2] === 'px' ? parseFloat(m[1]) * 0.75 : parseFloat(m[1])
  return pt >= 1 && pt <= 409 ? Math.round(pt * 2) / 2 : undefined
}

/** "1px solid rgb(0, 0, 0)" 같은 CSS 테두리 한 변 → 엑셀 테두리. 없음/해석 불가면 undefined */
export function cssBorderToExcel(css: string | undefined): Partial<Border> | undefined {
  if (!css) return undefined
  const v = css.trim().toLowerCase()
  if (!v || v === 'none' || v.startsWith('0')) return undefined
  const width = /(\d+(?:\.\d+)?)px/.exec(v)
  const px = width ? parseFloat(width[1]) : 1
  if (px <= 0) return undefined
  const kind = /\b(dashed|dotted|double)\b/.exec(v)?.[1]
  let style: BorderStyle
  if (kind === 'double') style = 'double'
  else if (kind === 'dotted') style = px > 1 ? 'mediumDashDot' : 'dotted'
  else if (kind === 'dashed') style = px > 1 ? 'mediumDashed' : 'dashed'
  else style = px >= 3 ? 'thick' : px >= 2 ? 'medium' : 'thin'
  const colorText = /(#[0-9a-f]{3,6}|rgba?\([^)]*\))/i.exec(css)?.[1]
  const argb = cssColorToArgb(colorText) ?? 'FF000000'
  return { style, color: { argb } }
}

export interface ExcelCellStyle {
  font?: Partial<Font>
  fill?: Fill
  alignment?: Partial<Alignment>
  border?: Partial<Borders>
}

/** 셀 서식 한 칸 → exceljs 스타일 조각. 서식이 없으면 빈 객체 */
export function formattingToExcelStyle(fmt: XlsxCellFormatting | undefined): ExcelCellStyle {
  const style: ExcelCellStyle = {}
  if (!fmt) return style

  const font: Partial<Font> = {}
  const fontColor = cssColorToArgb(fmt.color)
  if (fontColor) font.color = { argb: fontColor }
  if (fmt.fontWeight && (fmt.fontWeight === 'bold' || parseInt(fmt.fontWeight, 10) >= 600)) font.bold = true
  if (fmt.fontStyle && /\bitalic\b/i.test(fmt.fontStyle)) font.italic = true
  if (fmt.textDecoration && /\bunderline\b/i.test(fmt.textDecoration)) font.underline = true
  if (fmt.textDecoration && /\bline-through\b/i.test(fmt.textDecoration)) font.strike = true
  const sizePt = cssFontSizeToPt(fmt.fontSize)
  if (sizePt) font.size = sizePt
  if (fmt.fontFamily) {
    const family = fmt.fontFamily.split(',')[0].replace(/["']/g, '').trim()
    if (family && family.toLowerCase() !== 'default' && family.toLowerCase() !== 'inherit') font.name = family
  }
  if (Object.keys(font).length) style.font = font

  const bg = cssColorToArgb(fmt.backgroundColor)
  if (bg) style.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }

  const alignment: Partial<Alignment> = {}
  if (fmt.textAlign === 'left' || fmt.textAlign === 'center' || fmt.textAlign === 'right' || fmt.textAlign === 'justify') {
    alignment.horizontal = fmt.textAlign
  }
  if (fmt.verticalAlign === 'top' || fmt.verticalAlign === 'bottom') alignment.vertical = fmt.verticalAlign
  else if (fmt.verticalAlign === 'middle') alignment.vertical = 'middle'
  if (Object.keys(alignment).length) style.alignment = alignment

  // 변 단위 테두리가 있으면 그것을, 없으면 가져오기에서 온 단일 색(borderColor)을 사방 가는 선으로
  const sides: Partial<Borders> = {}
  const top = cssBorderToExcel(fmt.borderTop)
  const right = cssBorderToExcel(fmt.borderRight)
  const bottom = cssBorderToExcel(fmt.borderBottom)
  const left = cssBorderToExcel(fmt.borderLeft)
  if (top) sides.top = top
  if (right) sides.right = right
  if (bottom) sides.bottom = bottom
  if (left) sides.left = left
  if (!Object.keys(sides).length) {
    const argb = cssColorToArgb(fmt.borderColor)
    if (argb) {
      const line: Partial<Border> = { style: 'thin', color: { argb } }
      Object.assign(sides, { top: line, right: line, bottom: line, left: line })
    }
  }
  if (Object.keys(sides).length) style.border = sides

  return style
}

/** 화면 픽셀 너비 → 엑셀 열 너비(글자 수 단위, 기본 글꼴 기준 7px/글자 + 여백 5px) */
export function pxToExcelWidth(px: number | null | undefined): number | undefined {
  if (typeof px !== 'number' || !isFinite(px) || px <= 0) return undefined
  return Math.max(1, Math.min(255, Math.round(((px - 5) / 7) * 100) / 100))
}

// ───────────────────────────── 조립 ─────────────────────────────

function fillSheet(ws: import('exceljs').Worksheet, sheet: SpreadsheetSheet, state: { hadImage: boolean }): void {
  const rows = Array.isArray(sheet.rows) ? sheet.rows : []
  let maxCols = 0

  rows.forEach((row, r) => {
    const cells = Array.isArray(row) ? row : []
    maxCols = Math.max(maxCols, cells.length)
    cells.forEach((raw, c) => {
      if (typeof raw === 'string' && hasImageOverlay(raw)) state.hadImage = true
      const text = toCellText(raw)
      const link = typeof raw === 'string' ? splitCellLink(hasImageOverlay(raw) ? splitCellImageOverlay(raw).text : raw).url : null
      const fmt = sheet.cellFormatting?.[r]?.[c]
      const style = formattingToExcelStyle(fmt)
      if (!text && !Object.keys(style).length) return // 값도 서식도 없는 칸은 만들지 않는다
      const cell = ws.getCell(r + 1, c + 1)
      // 수식 칸 — 수식과 계산 결과를 함께 써서 엑셀에서 계속 계산되게 한다(안전하지 않은 수식은 값만)
      const formula = sheet.formulas?.[cellAddress(r, c)]
      const excelFormula = formula ? toExcelFormula(formula) : null
      if (excelFormula) {
        const asNumber = text.trim() !== '' && Number.isFinite(Number(text.replace(/,/g, ''))) ? Number(text.replace(/,/g, '')) : null
        cell.value = { formula: excelFormula, result: asNumber ?? text }
      } else {
        cell.value = text === '' ? null : link ? { text, hyperlink: link } : text
      }
      if (style.font) cell.font = style.font
      if (style.fill) cell.fill = style.fill
      if (style.border) cell.border = style.border
      const alignment: Partial<Alignment> = { ...(style.alignment ?? {}) }
      // 편집기는 셀 안 글을 자동 줄바꿈으로 보여 주므로(wordWrap) 엑셀에서도 같게 보이도록 항상 켠다
      alignment.wrapText = fmt?.wrapText !== false
      if (Object.keys(alignment).length) cell.alignment = alignment
    })
  })

  // 행 높이(px → pt)
  ;(sheet.rowHeights ?? []).forEach((h, r) => {
    if (typeof h === 'number' && h > 0 && h <= 546) ws.getRow(r + 1).height = Math.round(h * 0.75 * 100) / 100
  })

  const colCount = Math.max(maxCols, sheet.colWidths?.length ?? 0)
  for (let c = 0; c < colCount; c++) {
    const width = pxToExcelWidth(sheet.colWidths?.[c])
    if (width) ws.getColumn(c + 1).width = width
  }

  // 병합 — 범위가 겹치거나 시트 밖이면 그 병합만 건너뛴다(엑셀이 파일 복구를 요구하지 않도록)
  const taken = new Set<string>()
  for (const m of sheet.merges ?? []) {
    if (!m || m.s.r < 0 || m.s.c < 0 || m.e.r < m.s.r || m.e.c < m.s.c) continue
    if (m.s.r === m.e.r && m.s.c === m.e.c) continue
    const keys: string[] = []
    let overlap = false
    for (let r = m.s.r; r <= m.e.r && !overlap; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        const k = `${r}:${c}`
        if (taken.has(k)) { overlap = true; break }
        keys.push(k)
      }
    }
    if (overlap) continue
    keys.forEach((k) => taken.add(k))
    ws.mergeCells(m.s.r + 1, m.s.c + 1, m.e.r + 1, m.e.c + 1)
  }
}

/** 스프레드시트 문서 → .xlsx 바이트. exceljs 는 이 함수가 처음 불릴 때 내려받는다 */
export async function spreadsheetToXlsxBlob(doc: SpreadsheetDocument, title: string): Promise<XlsxBuildResult> {
  const sheets = Array.isArray(doc?.sheets) ? doc.sheets : []
  if (sheets.length === 0) throw new Error('저장할 시트가 없습니다.')

  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = '크레이지샷'
  wb.title = String(title ?? '').slice(0, 255)
  wb.created = new Date()

  const names = toSafeSheetNames(sheets.map((s) => s.name))
  const state = { hadImage: false }
  const allHidden = sheets.every((s) => s.hidden)
  sheets.forEach((sheet0, i) => {
    // 엑셀은 보이는 시트가 하나는 있어야 한다 — 전부 숨김이면 첫 시트를 보이게
    const sheet = allHidden && i === 0 ? { ...sheet0, hidden: false } : sheet0
    // 숨김 시트·틀 고정은 엑셀 시트 속성으로
    const ws = wb.addWorksheet(names[i], {
      state: sheet.hidden ? 'hidden' : 'visible',
      views: sheet.freeze && (sheet.freeze.rows > 0 || sheet.freeze.cols > 0)
        ? [{ state: 'frozen', xSplit: sheet.freeze.cols, ySplit: sheet.freeze.rows }]
        : undefined,
    })
    fillSheet(ws, sheet, state)
  })
  if (typeof doc.activeSheetIndex === 'number' && doc.activeSheetIndex >= 0 && doc.activeSheetIndex < sheets.length) {
    wb.views = [{ x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: doc.activeSheetIndex, visibility: 'visible' }]
  }

  const buffer = await wb.xlsx.writeBuffer()
  const warnings: string[] = []
  if (state.hadImage) warnings.push('서명·직인 이미지는 엑셀 파일에 들어가지 않아요. 글자만 저장됩니다.')
  return { blob: new Blob([buffer as BlobPart], { type: XLSX_MIME }), warnings }
}
