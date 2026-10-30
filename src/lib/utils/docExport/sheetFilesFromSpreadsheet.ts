/**
 * sheetFilesFromSpreadsheet.ts — 스프레드시트형 양식 → .ods / .csv / .tsv 파일 만들기 (브라우저 전용, 2026-10-29)
 *
 * 구글 시트 "다운로드" 메뉴와 같은 구성을 맞추기 위한 형식들이다(엑셀·PDF·웹 문서는 다른 모듈).
 *  .csv / .tsv  현재 보고 있는 시트 하나만, 값만 저장(서식·병합 없음). 한글이 깨지지 않도록 UTF-8 BOM 을 붙인다.
 *  .ods         모든 시트의 값·병합·열 너비. 셀 서식(색·글꼴·테두리)은 이 변환기가 지원하지 않아 들어가지 않는다.
 * 서명·직인 이미지 겹침은 글자만 남긴다. `{{변수}}`는 그대로 둔다.
 */
import type { SpreadsheetDocument, SpreadsheetSheet } from '$lib/types/contract-document'
import { hasImageOverlay, splitCellImageOverlay, splitCellLink } from '$lib/types/sheet-format'
import { toSafeSheetNames } from './xlsxFromSpreadsheet'

export const ODS_MIME = 'application/vnd.oasis.opendocument.spreadsheet'
export const CSV_MIME = 'text/csv;charset=utf-8'
export const TSV_MIME = 'text/tab-separated-values;charset=utf-8'

export interface SheetFileResult {
  blob: Blob
  warnings: string[]
}

function cellText(value: unknown, state: { hadImage: boolean }): string {
  if (value === null || value === undefined) return ''
  let text = String(value)
  if (hasImageOverlay(text)) {
    state.hadImage = true
    text = splitCellImageOverlay(text).text
  }
  return splitCellLink(text).text
}

const IMAGE_WARNING = '서명·직인 이미지는 이 형식에 들어가지 않아요. 글자만 저장됩니다.'

/** 현재 보고 있는 시트(없으면 첫 시트) */
function activeSheet(doc: SpreadsheetDocument): SpreadsheetSheet {
  const sheet = doc.sheets[doc.activeSheetIndex] ?? doc.sheets[0]
  if (!sheet) throw new Error('저장할 시트가 없습니다.')
  return sheet
}

/** 쉼표·탭 구분 파일의 한 칸 — 구분자·따옴표·줄바꿈이 있으면 따옴표로 감싼다(CSV 표준) */
function escapeDelimited(text: string, delimiter: string): string {
  if (text.includes(delimiter) || text.includes('"') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

/** 현재 시트를 구분자 파일(.csv=',' / .tsv='\t')로 */
export function spreadsheetToDelimitedBlob(doc: SpreadsheetDocument, delimiter: ',' | '\t'): SheetFileResult {
  const sheet = activeSheet(doc)
  const state = { hadImage: false }
  const lines = sheet.rows.map((row) => row.map((cell) => escapeDelimited(cellText(cell, state), delimiter)).join(delimiter))
  const warnings: string[] = []
  if (doc.sheets.length > 1) warnings.push(`이 형식은 시트 하나만 저장돼요. 현재 시트("${sheet.name}")만 저장했습니다.`)
  if (state.hadImage) warnings.push(IMAGE_WARNING)
  const body = '﻿' + lines.join('\r\n') + '\r\n'
  return { blob: new Blob([body], { type: delimiter === ',' ? CSV_MIME : TSV_MIME }), warnings }
}

/** 모든 시트를 .ods(OpenDocument 스프레드시트)로. SheetJS 는 처음 부를 때 내려받는다 */
export async function spreadsheetToOdsBlob(doc: SpreadsheetDocument): Promise<SheetFileResult> {
  if (doc.sheets.length === 0) throw new Error('저장할 시트가 없습니다.')
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const state = { hadImage: false }
  const names = toSafeSheetNames(doc.sheets.map((s) => s.name))
  doc.sheets.forEach((sheet, i) => {
    const aoa = sheet.rows.map((row) => row.map((cell) => cellText(cell, state)))
    const ws = XLSX.utils.aoa_to_sheet(aoa.length ? aoa : [['']])
    if (sheet.merges.length) ws['!merges'] = sheet.merges.map((m) => ({ s: { r: m.s.r, c: m.s.c }, e: { r: m.e.r, c: m.e.c } }))
    const cols = (sheet.colWidths ?? []).map((w) => (typeof w === 'number' && w > 0 ? { wpx: w } : {}))
    if (cols.some((c) => 'wpx' in c)) ws['!cols'] = cols
    XLSX.utils.book_append_sheet(wb, ws, names[i])
  })
  const bytes = XLSX.write(wb, { bookType: 'ods', type: 'array' }) as ArrayBuffer
  const warnings = ['셀 서식(색·글꼴·테두리)은 .ods 파일에 들어가지 않아요. 서식까지 필요하면 엑셀(.xlsx)로 저장해 주세요.']
  if (state.hadImage) warnings.push(IMAGE_WARNING)
  return { blob: new Blob([bytes], { type: ODS_MIME }), warnings }
}
