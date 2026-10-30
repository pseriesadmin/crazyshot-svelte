// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import type { SpreadsheetDocument, SpreadsheetSheet } from '$lib/types/contract-document'
import { splitCellLink, toLinkMarker, plainCellText, toImageOverlayMarker } from '$lib/types/sheet-format'
import { parseDrawnLines, applyLinesToSheet, parseCellRef, applyWorkbookExtras } from '$lib/utils/docImport/xlsxExtras'
import { importWorkbookAsSpreadsheetDocument } from '$lib/utils/docImport/xlsxToSpreadsheetDocument'
import { renderSpreadsheetToHtml } from '$lib/utils/spreadsheetRender'
import { spreadsheetToXlsxBlob } from '$lib/utils/docExport/xlsxFromSpreadsheet'
import { spreadsheetDocToExportHtml } from '$lib/utils/docExport/exportHtml'
import { spreadsheetToDelimitedBlob } from '$lib/utils/docExport/sheetFilesFromSpreadsheet'

// 실제 원본(결과보고서+필증 양식 합본)의 제목 밑줄 도형 두 개
const DRAWING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>28575</xdr:rowOff></xdr:from><xdr:to><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>38100</xdr:rowOff></xdr:to>
<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="3" name="Line 14"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="57150" cmpd="thinThick"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></xdr:spPr></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>
<xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>5</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
<xdr:cxnSp macro=""><xdr:nvCxnSpPr><xdr:cNvPr id="4" name="c"/><xdr:cNvCxnSpPr/></xdr:nvCxnSpPr><xdr:spPr><a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom><a:ln w="9525"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:prstDash val="dash"/></a:ln></xdr:spPr></xdr:cxnSp><xdr:clientData/></xdr:twoCellAnchor>
<xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
<xdr:sp macro=""><xdr:nvSpPr><xdr:cNvPr id="5" name="diag"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="9525"/></xdr:spPr></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>
</xdr:wsDr>`

const sheet = (over: Partial<SpreadsheetSheet> = {}): SpreadsheetSheet => ({
  name: 'S',
  rows: Array.from({ length: 8 }, () => ['', '', '', '']),
  merges: [], colWidths: [50, 50, 50, 50], rowHeights: Array.from({ length: 8 }, () => 20), cellFormatting: [], ...over,
})

describe('링크 표식', () => {
  it('왕복·안전하지 않은 주소 거부', () => {
    const v = `바로가기${toLinkMarker('https://crazyshot.kr/a?b=1&c=한글')}`
    expect(splitCellLink(v)).toEqual({ text: '바로가기', url: 'https://crazyshot.kr/a?b=1&c=한글' })
    expect(splitCellLink(`x${toLinkMarker('javascript:alert(1)')}`).url).toBeNull()
    expect(splitCellLink('그냥 글자').url).toBeNull()
  })
  it('이미지 표식과 함께 있어도 보이는 글자만 남긴다', () => {
    const v = `서명${toLinkMarker('https://x.test')}${toImageOverlayMarker('https://x.test/a.png', 50, 1, 2)}`
    expect(plainCellText(v)).toBe('서명')
  })
})

describe('도형·선 → 테두리', () => {
  it('가로·세로 직선만 읽고 사선은 건너뛴다', () => {
    const lines = parseDrawnLines(DRAWING)
    expect(lines).toHaveLength(3) // 사선도 읽히지만 적용 단계에서 건너뛴다
    expect(lines[0]).toMatchObject({ style: 'double', widthPx: 6, color: '#000000' })
    expect(lines[1]).toMatchObject({ style: 'dashed', widthPx: 1, color: '#FF0000' })
  })
  it('가로선은 가장 가까운 행 경계의 위쪽 테두리로, 걸친 칸 모두에', () => {
    const out = applyLinesToSheet(sheet(), parseDrawnLines(DRAWING).slice(0, 1))
    // 행 1(0부터) 위쪽 가까이(오프셋 3px) → borderTop, 열 1~2 (x 50~150)
    expect(out.cellFormatting[1][1].borderTop).toBe('6px double #000000')
    expect(out.cellFormatting[1][2].borderTop).toBe('6px double #000000')
    expect(out.cellFormatting[1][0]?.borderTop).toBeUndefined()
    expect(out.cellFormatting[1][3]?.borderTop).toBeUndefined()
  })
  it('세로선은 열 경계의 왼쪽 테두리로', () => {
    const out = applyLinesToSheet(sheet(), [parseDrawnLines(DRAWING)[1]])
    expect(out.cellFormatting[3][0].borderLeft).toBe('1px dashed #FF0000')
    expect(out.cellFormatting[4][0].borderLeft).toBe('1px dashed #FF0000')
    expect(out.cellFormatting[5]?.[0]?.borderLeft).toBeUndefined()
  })
  it('사선은 테두리로 바꾸지 않는다', () => {
    const out = applyLinesToSheet(sheet(), [parseDrawnLines(DRAWING)[2]])
    expect(out.cellFormatting.flat().some((f) => f.borderTop || f.borderBottom || f.borderLeft || f.borderRight)).toBe(false)
  })
  it('이미 더 굵은 테두리가 있으면 덮어쓰지 않는다', () => {
    const base = sheet({ cellFormatting: [[], [{}, { borderTop: '9px solid #000000' }]] })
    expect(applyLinesToSheet(base, parseDrawnLines(DRAWING).slice(0, 1)).cellFormatting[1][1].borderTop).toBe('9px solid #000000')
  })
  it('칸 주소 해석', () => {
    expect(parseCellRef('B7')).toEqual({ row: 6, col: 1 })
    expect(parseCellRef('AA10:AB12')).toEqual({ row: 9, col: 26 })
    expect(parseCellRef('?')).toBeNull()
  })
})

async function makeFile(): Promise<File> {
  const wb = new ExcelJS.Workbook()
  const a = wb.addWorksheet('앞')
  a.getCell('A1').value = { text: '홈페이지', hyperlink: 'https://crazyshot.kr' }
  a.getCell('A2').value = { text: '위험', hyperlink: 'javascript:alert(1)' }
  a.getCell('B1').value = '내용'
  a.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }]
  const b = wb.addWorksheet('숨김시트', { state: 'hidden' })
  b.getCell('A1').value = 'secret'
  return new File([(await wb.xlsx.writeBuffer()) as ArrayBuffer], 'e.xlsx')
}

describe('가져오기 — 숨김 시트·틀 고정·하이퍼링크', () => {
  it('숨김 시트 표시, 틀 고정 값, 외부 링크만 링크 표식으로', async () => {
    const doc = await importWorkbookAsSpreadsheetDocument(await makeFile())
    expect(doc.sheets[0].hidden).toBeUndefined()
    expect(doc.sheets[1].hidden).toBe(true)
    expect(doc.sheets[0].freeze).toEqual({ rows: 1, cols: 1 })
    expect(splitCellLink(doc.sheets[0].rows[0][0])).toEqual({ text: '홈페이지', url: 'https://crazyshot.kr' })
    expect(doc.sheets[0].rows[1][0]).toBe('위험') // 안전하지 않은 주소는 링크로 만들지 않는다
    expect(doc.activeSheetIndex).toBe(0)
  })
  it('첫 시트가 숨김이면 처음 보이는 시트를 활성으로', () => {
    const doc: SpreadsheetDocument = { activeSheetIndex: 0, sheets: [sheet({ name: 'A' }), sheet({ name: 'B' })] }
    const out = applyWorkbookExtras(doc, new Map([['A', { hidden: true, freeze: null, links: [], lines: [] }]]))
    expect(out.activeSheetIndex).toBe(1)
  })
})

describe('고객 화면·내보내기', () => {
  const doc: SpreadsheetDocument = {
    activeSheetIndex: 0,
    sheets: [
      sheet({ name: '보임', rows: [[`홈${toLinkMarker('https://crazyshot.kr/?a=1&b=2')}`, 'x']], rowHeights: [20], colWidths: [50, 50], freeze: { rows: 1, cols: 1 } }),
      sheet({ name: '숨김', rows: [['비밀', 'y']], rowHeights: [20], colWidths: [50, 50], hidden: true }),
    ],
  }
  it('링크는 <a>로, 숨김 시트는 빠진다', () => {
    const html = renderSpreadsheetToHtml(doc)
    expect(html).toContain('<a href="https://crazyshot.kr/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer nofollow">홈</a>')
    expect(html).not.toContain('비밀')
    expect(html).not.toContain('cs-link://')
  })
  it('웹/PDF 저장용 HTML도 숨김 시트 제외, csv 는 링크 표식 제거', async () => {
    expect(spreadsheetDocToExportHtml(doc).html).not.toContain('비밀')
    const csv = await spreadsheetToDelimitedBlob(doc, ',').blob.text()
    expect(csv).toContain('홈,x')
    expect(csv).not.toContain('cs-link')
  })
  it('엑셀: 하이퍼링크·숨김 시트·틀 고정이 들어간다', async () => {
    const { blob } = await spreadsheetToXlsxBlob(doc, 't')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await blob.arrayBuffer())
    const a = wb.getWorksheet('보임')!
    expect(a.getCell('A1').value).toMatchObject({ text: '홈', hyperlink: 'https://crazyshot.kr/?a=1&b=2' })
    expect(a.views[0]).toMatchObject({ state: 'frozen', xSplit: 1, ySplit: 1 })
    expect(wb.getWorksheet('숨김')!.state).toBe('hidden')
  })
  it('엑셀 왕복: 내보낸 파일을 다시 가져와도 링크·숨김·틀 고정이 같다', async () => {
    const { blob } = await spreadsheetToXlsxBlob(doc, 't')
    const back = await importWorkbookAsSpreadsheetDocument(new File([await blob.arrayBuffer()], 'b.xlsx'))
    expect(back.sheets[1].hidden).toBe(true)
    expect(back.sheets[0].freeze).toEqual({ rows: 1, cols: 1 })
    expect(splitCellLink(back.sheets[0].rows[0][0]).url).toBe('https://crazyshot.kr/?a=1&b=2')
  })
})

describe('수식 저장·복원·내보내기', () => {
  it('수식 칸은 원문을 formulas 에, 값에는 계산 결과를 담는다(위젯 → 문서)', async () => {
    const { worksheetConfigToSheet, sheetToWorksheetConfig, trimSheetToUsedRange } = await import('$lib/components/cms/contract-editor/spreadsheetWidgetAdapter')
    const ws = {
      getData: () => [['5', '7', '=A1+B1']], getMerge: () => ({}), getStyle: () => ({}), getWidth: () => [50, 50, 50],
      getValueFromCoords: (x: number, y: number, processed?: boolean) => (processed && x === 2 && y === 0 ? 12 : null),
      getSelection: () => [0, 0, 0, 0], updateSelectionFromCoords: () => {}, setValueFromCoords: () => {}, setWidth: () => {}, setStyle: () => {},
    } as unknown as Parameters<typeof worksheetConfigToSheet>[1]
    const s = worksheetConfigToSheet('S', ws)
    expect(s.rows).toEqual([['5', '7', '12']])
    expect(s.formulas).toEqual({ C1: '=A1+B1' })
    // 다시 열 때는 수식 원문을 칸에 되돌린다
    expect(sheetToWorksheetConfig(s).data).toEqual([['5', '7', '=A1+B1']])
    // 뒤쪽 빈칸 정리에서도 수식 칸은 쓰인 영역으로 본다
    const padded = { ...s, rows: [['', '', '', ''], ['', '', '', '']], formulas: { C2: '=A1' }, colWidths: [1, 1, 1, 1], cellFormatting: [] }
    expect(trimSheetToUsedRange(padded).rows).toHaveLength(2)
  })
  it('엑셀 내보내기: 안전한 수식은 수식+결과로, 위험한 모양은 값만', async () => {
    const { toExcelFormula } = await import('$lib/utils/docExport/xlsxFromSpreadsheet')
    expect(toExcelFormula('=SUM(A1:B2)')).toBe('SUM(A1:B2)')
    expect(toExcelFormula('=A1*2+1')).toBe('A1*2+1')
    expect(toExcelFormula('=SUM(A1')).toBeNull()
    expect(toExcelFormula('=HYPERLINK("x")')).toBeNull()
    expect(toExcelFormula('=WEBSERVICE("http://x")')).toBeNull()
    expect(toExcelFormula('=cmd|\'/c calc\'!A1')).toBeNull()
    const d: SpreadsheetDocument = { activeSheetIndex: 0, sheets: [sheet({ name: 'F', rows: [['5', '7', '12', '=bad(']], formulas: { C1: '=A1+B1' }, colWidths: [50, 50, 50, 50], rowHeights: [20] })] }
    const { blob } = await spreadsheetToXlsxBlob(d, 't')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await blob.arrayBuffer())
    const c1 = wb.getWorksheet('F')!.getCell('C1').value as { formula: string; result: number }
    expect(c1.formula).toBe('A1+B1')
    expect(c1.result).toBe(12)
  })
})
