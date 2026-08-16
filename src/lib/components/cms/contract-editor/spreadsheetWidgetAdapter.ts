/**
 * spreadsheetWidgetAdapter.ts — SpreadsheetSheet ↔ jspreadsheet-ce 설정 변환
 *
 * SpreadsheetDocument(자체 스키마)를 jspreadsheet-ce 위젯 설정으로 변환(sheetToWorksheetConfig)하고,
 * 위젯에서 편집된 데이터를 다시 SpreadsheetSheet 형식으로 읽어오는(worksheetConfigToSheet)
 * 순수 변환 어댑터.
 *
 * DOM 미사용 — XLSX.utils.encode_cell/decode_cell은 순수 산술 함수.
 * jspreadsheet-ce는 ContractSpreadsheetEditor.svelte의 onMount 내부에서만 동적 import됨.
 * 이 파일은 jspreadsheet-ce를 import하지 않아 SSR 번들에 포함되지 않는다.
 */

import * as XLSX from 'xlsx'
import type { SpreadsheetSheet } from '$lib/types/contract-document'
import type { SheetMergeRange, XlsxCellFormatting } from '$lib/types/sheet-format'
import { fitColumnWidthsToTarget } from '$lib/utils/docImport/fitColumnWidths'

// ─────────────────────────────────────────────────────────────────────────────
// jspreadsheet-ce API duck-type 인터페이스 (런타임 import 없음)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * worksheetConfigToSheet()에서 사용하는 WorksheetInstance 메서드만 duck-type으로 정의.
 * jspreadsheet-ce를 직접 import하지 않아도 타입 안전성을 유지한다.
 */
export interface JssWorksheetInstance {
  /** 전체 셀 데이터를 2D 배열로 반환 */
  getData(): (string | number | boolean)[][]
  /** 병합 정보 전체(인수 없음)를 "셀주소→[colspan, rowspan]" 레코드로 반환 */
  getMerge(): Record<string, [number, number]>
  /** 전체 셀 스타일을 "셀주소→CSS 문자열" 레코드로 반환 */
  getStyle(): Record<string, string>
  /** 전체 컬럼 너비 배열 반환 */
  getWidth(): (number | string)[]
  /** 현재 선택 범위 좌표 [좌상단x, 좌상단y, 우하단x, 우하단y] */
  getSelection(): [number, number, number, number]
  /** 좌표로 셀 값 조회 */
  getValueFromCoords(x: number, y: number): string | number | boolean | null
  /** 좌표로 셀 값 설정 */
  setValueFromCoords(x: number, y: number, value: string | number | boolean): void
  /** 컬럼 너비 지정 — "A4 용지 맞춤" 보조도구(ContractSpreadsheetEditor.svelte)에서 사용 */
  setWidth(column: number, width: number): void
}

/**
 * sheetToWorksheetConfig()의 반환 타입 — jspreadsheet-ce에 전달하는 워크시트 설정.
 * 실제 WorksheetOptions의 부분 집합으로 구조적으로 호환된다.
 */
export interface JssWorksheetConfig {
  worksheetName: string
  data: string[][]
  columns: { width: number }[]
  mergeCells: Record<string, [number, number]>
  style: Record<string, string>
  tableOverflow: boolean
  tableWidth: string
}

// ─────────────────────────────────────────────────────────────────────────────
// 병합 좌표 ↔ 셀 주소 변환 (SheetMergeRange ↔ jss mergeCells 포맷)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SheetMergeRange[] → jspreadsheet-ce mergeCells 레코드.
 * 각 병합의 좌상단(anchor) {r, c}를 XLSX.utils.encode_cell로 "A1" 형식으로 변환한다.
 */
export function mergesToJss(merges: SheetMergeRange[]): Record<string, [number, number]> {
  const result: Record<string, [number, number]> = {}
  for (const m of merges) {
    if (m.e.r < m.s.r || m.e.c < m.s.c) continue // 비정상 범위 스킵
    const addr = XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c })
    const colspan = m.e.c - m.s.c + 1
    const rowspan = m.e.r - m.s.r + 1
    result[addr] = [colspan, rowspan]
  }
  return result
}

/**
 * jspreadsheet-ce getMerge() 레코드 → SheetMergeRange[].
 * 셀 주소 "A1"를 XLSX.utils.decode_cell로 {r, c}로 역변환하고 end 좌표를 계산한다.
 */
export function jssMergesToSheet(
  mergeRecord: Record<string, [number, number]>,
): SheetMergeRange[] {
  return Object.entries(mergeRecord).map(([addr, [colspan, rowspan]]) => {
    const { r, c } = XLSX.utils.decode_cell(addr)
    return {
      s: { r, c },
      e: { r: r + rowspan - 1, c: c + colspan - 1 },
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// XlsxCellFormatting ↔ CSS 문자열 (jspreadsheet-ce style 레코드 형식)
// ─────────────────────────────────────────────────────────────────────────────

/** XlsxCellFormatting → CSS 문자열 (비어 있으면 '' 반환) */
function formattingToCss(fmt: XlsxCellFormatting): string {
  const parts: string[] = []
  if (fmt.backgroundColor) parts.push(`background-color: ${fmt.backgroundColor}`)
  if (fmt.borderColor) parts.push(`border: 1px solid ${fmt.borderColor}`)
  return parts.join('; ')
}

/** CSS 문자열 → XlsxCellFormatting */
function cssToFormatting(css: string): XlsxCellFormatting {
  const fmt: XlsxCellFormatting = {}
  const bgMatch = css.match(/background-color:\s*([^;]+)/i)
  if (bgMatch) fmt.backgroundColor = bgMatch[1].trim()
  const borderMatch = css.match(/border:[^;]*\bsolid\s+([^;]+)/i)
  if (borderMatch) fmt.borderColor = borderMatch[1].trim()
  return fmt
}

// ─────────────────────────────────────────────────────────────────────────────
// 주 변환 함수
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SpreadsheetSheet → jspreadsheet-ce 워크시트 설정.
 *
 * - colWidths: fitColumnWidthsToTarget()으로 A4 폭(642px) 초과 시 비율 축소
 * - merges: SheetMergeRange[] → 셀 주소 키 Record
 * - cellFormatting: [행][열] → "셀주소→CSS 문자열" Record
 */
export function sheetToWorksheetConfig(sheet: SpreadsheetSheet): JssWorksheetConfig {
  const fittedWidths = fitColumnWidthsToTarget(sheet.colWidths)

  const columns: { width: number }[] = fittedWidths.map((w) => ({
    width: typeof w === 'number' && w > 0 ? w : 100,
  }))

  const mergeCells = mergesToJss(sheet.merges)

  const style: Record<string, string> = {}
  sheet.cellFormatting.forEach((rowFmts, rowIdx) => {
    rowFmts.forEach((fmt, colIdx) => {
      const css = formattingToCss(fmt)
      if (css) {
        const addr = XLSX.utils.encode_cell({ r: rowIdx, c: colIdx })
        style[addr] = css
      }
    })
  })

  return {
    worksheetName: sheet.name,
    data: sheet.rows,
    columns,
    mergeCells,
    style,
    tableOverflow: true,
    tableWidth: '100%',
  }
}

/**
 * WorksheetInstance → SpreadsheetSheet.
 *
 * 편집 완료된 jspreadsheet-ce 위젯에서 자체 스키마로 데이터를 읽어온다.
 * getData()/getMerge()/getStyle()/getWidth() API를 순서대로 호출한다.
 */
export function worksheetConfigToSheet(
  name: string,
  ws: JssWorksheetInstance,
): SpreadsheetSheet {
  const rawData = ws.getData()
  const rows: string[][] = rawData.map((row) =>
    row.map((cell) => (cell == null ? '' : String(cell))),
  )

  const rowCount = rows.length
  const colCount = rows[0]?.length ?? 0

  const mergeRecord = ws.getMerge()
  const merges = jssMergesToSheet(mergeRecord ?? {})

  const rawWidths = ws.getWidth()
  const colWidths: (number | null)[] = Array.from({ length: colCount }, (_, i) => {
    const w = rawWidths[i]
    if (typeof w === 'number') return w > 0 ? w : null
    if (typeof w === 'string') {
      const n = parseInt(w, 10)
      return !isNaN(n) && n > 0 ? n : null
    }
    return null
  })

  const styleRecord = ws.getStyle()

  const cellFormatting: XlsxCellFormatting[][] = Array.from({ length: rowCount }, (_, r) =>
    Array.from({ length: colCount }, (_, c) => {
      const addr = XLSX.utils.encode_cell({ r, c })
      const css = styleRecord[addr]
      return css ? cssToFormatting(css) : {}
    }),
  )

  return { name, rows, merges, colWidths, cellFormatting }
}
