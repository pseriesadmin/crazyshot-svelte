// @vitest-environment jsdom
/**
 * xlsxToSpreadsheetDocument.test.ts
 *
 * importWorkbookAsSpreadsheetDocument() / countTotalRows() 검증.
 * SheetJS + JSZip으로 합성 워크북을 구성해 픽스처 파일 없이 단위 테스트.
 */

import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { importWorkbookAsSpreadsheetDocument, countTotalRows } from '$lib/utils/docImport/xlsxToSpreadsheetDocument'

/**
 * 주어진 시트 데이터로 .xlsx File 객체를 합성한다.
 * xlsxTableMerge.test.ts와 동일한 "픽스처 파일 불필요" 패턴.
 */
async function makeXlsxFile(sheets: { name: string; rows: string[][] }[]): Promise<File> {
  const wb = XLSX.utils.book_new()
  for (const { name, rows } of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(rows)
    XLSX.utils.book_append_sheet(wb, ws, name)
  }
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return new File([buf], 'test.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 단일 시트 워크북
// ─────────────────────────────────────────────────────────────────────────────

describe('importWorkbookAsSpreadsheetDocument — 단일 시트', () => {
  it('시트 1개 → SpreadsheetDocument.sheets 길이 1, rows 포함', async () => {
    const file = await makeXlsxFile([{ name: 'Sheet1', rows: [['A', 'B'], ['1', '2']] }])
    const doc = await importWorkbookAsSpreadsheetDocument(file)
    expect(doc.sheets).toHaveLength(1)
    expect(doc.sheets[0].name).toBe('Sheet1')
    expect(doc.sheets[0].rows.length).toBeGreaterThan(0)
    expect(doc.activeSheetIndex).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 다중 시트 워크북
// ─────────────────────────────────────────────────────────────────────────────

describe('importWorkbookAsSpreadsheetDocument — 다중 시트', () => {
  it('시트 3개 → SpreadsheetDocument.sheets 길이 3, 각 시트명 보존', async () => {
    const file = await makeXlsxFile([
      { name: '계약정보', rows: [['항목', '내용'], ['상품명', '카메라']] },
      { name: '약관', rows: [['조항', '내용']] },
      { name: '서명', rows: [['서명인', '날짜']] },
    ])
    const doc = await importWorkbookAsSpreadsheetDocument(file)
    expect(doc.sheets).toHaveLength(3)
    expect(doc.sheets.map((s) => s.name)).toEqual(['계약정보', '약관', '서명'])
    expect(doc.activeSheetIndex).toBe(0)
  })

  it('각 시트가 rows/merges/colWidths/cellFormatting 필드를 모두 보유', async () => {
    const file = await makeXlsxFile([
      { name: 'A', rows: [['헤더1', '헤더2']] },
      { name: 'B', rows: [['값1', '값2'], ['값3', '값4']] },
    ])
    const doc = await importWorkbookAsSpreadsheetDocument(file)
    for (const sheet of doc.sheets) {
      expect(Array.isArray(sheet.rows)).toBe(true)
      expect(Array.isArray(sheet.merges)).toBe(true)
      expect(Array.isArray(sheet.colWidths)).toBe(true)
      expect(Array.isArray(sheet.cellFormatting)).toBe(true)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// countTotalRows
// ─────────────────────────────────────────────────────────────────────────────

describe('countTotalRows', () => {
  it('시트별 rows.length 합산 반환', () => {
    const doc = {
      sheets: [
        { name: 'A', rows: [['1'], ['2'], ['3']], merges: [], colWidths: [], cellFormatting: [] },
        { name: 'B', rows: [['x'], ['y']], merges: [], colWidths: [], cellFormatting: [] },
      ],
      activeSheetIndex: 0,
    }
    expect(countTotalRows(doc)).toBe(5)
  })

  it('빈 시트 목록이면 0 반환', () => {
    expect(countTotalRows({ sheets: [], activeSheetIndex: 0 })).toBe(0)
  })
})
