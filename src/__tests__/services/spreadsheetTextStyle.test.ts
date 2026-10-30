// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import type { SpreadsheetDocument, SpreadsheetSheet } from '$lib/types/contract-document'
import {
  cssToFormatting,
  decorationTokens,
  toggleDecoration,
  sheetToWorksheetConfig,
} from '$lib/components/cms/contract-editor/spreadsheetWidgetAdapter'
import { spreadsheetToXlsxBlob } from '$lib/utils/docExport/xlsxFromSpreadsheet'
import { renderSpreadsheetToHtml } from '$lib/utils/spreadsheetRender'

describe('기울임·밑줄·취소선 — CSS ↔ 서식 변환', () => {
  it('decorationTokens: 밑줄·취소선만 표준 순서로', () => {
    expect(decorationTokens('line-through underline')).toBe('underline line-through')
    expect(decorationTokens('underline solid red')).toBe('underline')
    expect(decorationTokens('none')).toBe('')
  })
  it('toggleDecoration: 한쪽만 바꾸고 다른 쪽은 유지', () => {
    expect(toggleDecoration('', 'underline', true)).toBe('underline')
    expect(toggleDecoration('underline', 'line-through', true)).toBe('underline line-through')
    expect(toggleDecoration('underline line-through', 'underline', false)).toBe('line-through')
    expect(toggleDecoration('underline', 'underline', false)).toBe('')
  })
  it('cssToFormatting 이 기울임·밑줄·취소선을 읽는다', () => {
    expect(cssToFormatting('font-style: italic; text-decoration: underline line-through')).toEqual({
      fontStyle: 'italic',
      textDecoration: 'underline line-through',
    })
    expect(cssToFormatting('font-style: normal')).toEqual({})
    expect(cssToFormatting('font-weight: bold')).toEqual({ fontWeight: 'bold' })
  })
  it('저장 → 재오픈: 서식이 위젯 스타일로 되돌아간다', () => {
    const sheet: SpreadsheetSheet = {
      name: 'S', rows: [['a']], merges: [], colWidths: [null],
      cellFormatting: [[{ fontStyle: 'italic', textDecoration: 'underline' }]],
    }
    expect(sheetToWorksheetConfig(sheet).style['A1']).toBe('font-style: italic; text-decoration: underline')
  })
})

describe('엑셀 내보내기 — 기울임·밑줄·취소선·자동 줄바꿈', () => {
  it('글꼴 서식과 줄바꿈이 파일에 들어간다', async () => {
    const doc: SpreadsheetDocument = {
      activeSheetIndex: 0,
      sheets: [{
        name: 'S', rows: [['a', 'b']], merges: [], colWidths: [null, null],
        cellFormatting: [[{ fontStyle: 'italic', textDecoration: 'underline line-through' }, {}]],
      }],
    }
    const { blob } = await spreadsheetToXlsxBlob(doc, 't')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await blob.arrayBuffer())
    const a1 = wb.getWorksheet('S')!.getCell('A1')
    expect(a1.font?.italic).toBe(true)
    expect(a1.font?.underline).toBe(true)
    expect(a1.font?.strike).toBe(true)
    expect(a1.alignment?.wrapText).toBe(true)
  })
})

describe('고객 화면 렌더 — 서식 허용 목록', () => {
  it('허용된 값만 style 로 나가고, 임의 값은 버린다', () => {
    const fn = renderSpreadsheetToHtml
    const mk = (fmt: Record<string, string>): SpreadsheetDocument => ({
      activeSheetIndex: 0,
      sheets: [{ name: 'S', rows: [['x']], merges: [], colWidths: [null], cellFormatting: [[fmt]] }],
    })
    const ok = fn(mk({ fontStyle: 'italic', textDecoration: 'underline line-through' }))
    expect(ok).toContain('font-style:italic')
    expect(ok).toContain('text-decoration:underline line-through')
    const bad = fn(mk({ fontStyle: 'italic;background:url(x)', textDecoration: 'underline;color:red' }))
    expect(bad).not.toContain('url(x)')
    expect(bad).not.toContain('text-decoration')
  })
})
