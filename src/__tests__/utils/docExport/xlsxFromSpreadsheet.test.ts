// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import type { SpreadsheetDocument } from '$lib/types/contract-document'
import { toImageOverlayMarker } from '$lib/types/sheet-format'
import {
  spreadsheetToXlsxBlob,
  toSafeSheetNames,
  toCellText,
  cssColorToArgb,
  cssFontSizeToPt,
  cssBorderToExcel,
  pxToExcelWidth,
} from '$lib/utils/docExport/xlsxFromSpreadsheet'
import { exportContractFile, FORMATS_BY_MODE } from '$lib/utils/docExport/exportContract'
import { importWorkbookAsSpreadsheetDocument } from '$lib/utils/docImport/xlsxToSpreadsheetDocument'

async function load(blob: Blob): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await blob.arrayBuffer())
  return wb
}

const DOC: SpreadsheetDocument = {
  activeSheetIndex: 0,
  sheets: [
    {
      name: '계약서',
      rows: [
        ['렌탈 계약서', '', '', ''],
        ['고객명', '{{고객명}}', '010-1234-5678', '00123'],
        ['=SUM(A1:A2)', '줄1\n줄2', `(인)${toImageOverlayMarker('https://x.test/a.png', 200, 0, 0)}`, ''],
      ],
      merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }],
      colWidths: [120, 100, null, 80],
      cellFormatting: [
        [{ backgroundColor: '#FFFF00', color: 'rgb(255, 0, 0)', fontWeight: 'bold', fontSize: '16pt', textAlign: 'center', verticalAlign: 'middle', fontFamily: 'Arial' }],
        [{ borderTop: '1px solid rgb(0, 0, 255)', borderBottom: '2px solid #000000' }, { borderColor: '#00FF00' }],
      ],
    },
    { name: '약관', rows: [['조항']], merges: [], colWidths: [60], cellFormatting: [] },
  ],
}

describe('xlsx 내보내기 — 값 변환 보조 함수', () => {
  it('시트 이름: 금지 글자 제거·31자 제한·중복 번호', () => {
    expect(toSafeSheetNames(['a/b:c', '', 'dup', 'DUP', 'x'.repeat(40)])).toEqual(['a b c', 'Sheet2', 'dup', 'DUP (2)', 'x'.repeat(31)])
  })
  it('셀 글자: 이미지 표식 제거·제어문자 제거·null은 빈 글자', () => {
    expect(toCellText(`(인)${toImageOverlayMarker('https://x.test/a.png')}`)).toBe('(인)')
    expect(toCellText('a\u0001b\tc\nd')).toBe('ab\tc\nd')
    expect(toCellText(null)).toBe('')
    expect(toCellText(12)).toBe('12')
  })
  it('색·크기·테두리·너비 변환', () => {
    expect(cssColorToArgb('#abc')).toBe('FFAABBCC')
    expect(cssColorToArgb('rgb(1, 2, 3)')).toBe('FF010203')
    expect(cssColorToArgb('rgba(0,0,0,0)')).toBeUndefined()
    expect(cssColorToArgb('red')).toBeUndefined()
    expect(cssFontSizeToPt('x-large')).toBe(18)
    expect(cssFontSizeToPt('16pt')).toBe(16)
    expect(cssFontSizeToPt('16px')).toBe(12)
    expect(cssBorderToExcel('1px solid rgb(0, 0, 255)')).toEqual({ style: 'thin', color: { argb: 'FF0000FF' } })
    expect(cssBorderToExcel('3px dashed #ff0000')).toEqual({ style: 'mediumDashed', color: { argb: 'FFFF0000' } })
    expect(cssBorderToExcel('none')).toBeUndefined()
    expect(pxToExcelWidth(75)).toBe(10)
    expect(pxToExcelWidth(null)).toBeUndefined()
  })
})

describe('xlsx 내보내기 — 파일 내용', () => {
  it('시트·값·병합·너비·서식이 파일에 들어간다', async () => {
    const { blob, warnings } = await spreadsheetToXlsxBlob(DOC, '테스트')
    const wb = await load(blob)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['계약서', '약관'])
    const ws = wb.getWorksheet('계약서')!
    expect(ws.getCell('A1').value).toBe('렌탈 계약서')
    expect(ws.getCell('A1').isMerged).toBe(true)
    expect(ws.getCell('B2').value).toBe('{{고객명}}')
    // 전화번호·앞자리 0은 글자 그대로, 수식처럼 보이는 글자는 수식이 아니라 글자로
    expect(ws.getCell('C2').value).toBe('010-1234-5678')
    expect(ws.getCell('D2').value).toBe('00123')
    expect(ws.getCell('A3').value).toBe('=SUM(A1:A2)')
    expect(ws.getCell('B3').alignment?.wrapText).toBe(true)
    // 이미지 표식은 떼고 글자만
    expect(ws.getCell('C3').value).toBe('(인)')
    expect(warnings.join(' ')).toContain('서명·직인')
    const a1 = ws.getCell('A1')
    expect(a1.font?.bold).toBe(true)
    expect(a1.font?.size).toBe(16)
    expect(a1.font?.name).toBe('Arial')
    expect(a1.font?.color?.argb).toBe('FFFF0000')
    expect((a1.fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFFFFF00')
    expect(a1.alignment?.horizontal).toBe('center')
    expect(a1.alignment?.vertical).toBe('middle')
    expect(ws.getCell('A2').border?.top?.style).toBe('thin')
    expect(ws.getCell('A2').border?.bottom?.style).toBe('medium')
    expect(ws.getCell('B2').border?.left?.color?.argb).toBe('FF00FF00')
    expect(ws.getColumn(1).width).toBeCloseTo(16.43, 1)
  })

  it('겹치는 병합은 건너뛰어 파일이 깨지지 않는다', async () => {
    const doc: SpreadsheetDocument = {
      activeSheetIndex: 0,
      sheets: [{ name: 'S', rows: [['a', 'b'], ['c', 'd']], merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }, { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } }], colWidths: [], cellFormatting: [] }],
    }
    const wb = await load((await spreadsheetToXlsxBlob(doc, 't')).blob)
    expect(wb.getWorksheet('S')!.getCell('A1').isMerged).toBe(true)
  })

  it('시트가 없으면 오류', async () => {
    await expect(spreadsheetToXlsxBlob({ sheets: [], activeSheetIndex: 0 }, 't')).rejects.toThrow('저장할 시트가 없습니다.')
  })

  it('다시 가져오면 값·병합·배경색이 그대로 돌아온다(왕복)', async () => {
    const { blob } = await spreadsheetToXlsxBlob(DOC, '왕복')
    const back = await importWorkbookAsSpreadsheetDocument(new File([await blob.arrayBuffer()], 'r.xlsx'))
    expect(back.sheets.map((s) => s.name)).toEqual(['계약서', '약관'])
    const s = back.sheets[0]
    expect(s.rows[0][0]).toBe('렌탈 계약서')
    expect(s.rows[1][1]).toBe('{{고객명}}')
    expect(s.rows[1][3]).toBe('00123')
    expect(s.merges).toEqual([{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }])
    expect(s.cellFormatting[0][0].backgroundColor).toBe('#FFFF00')
  })
})

describe('exportContractFile — 형식 제한', () => {
  it('모드별 허용 형식', () => {
    expect(FORMATS_BY_MODE.spreadsheet).toEqual(['xlsx', 'ods', 'pdf', 'html', 'csv', 'tsv'])
    expect(FORMATS_BY_MODE.flow).not.toContain('xlsx')
    expect(FORMATS_BY_MODE.html).not.toContain('xlsx')
  })
  it('문서형을 xlsx로 저장하면 거절', async () => {
    await expect(exportContractFile('xlsx', { mode: 'flow', title: 't', flowDoc: { type: 'doc', content: [] } })).rejects.toThrow('저장할 수 없어요')
  })
  it('스프레드시트 양식을 웹 문서(.html)로 저장 — 표·서식·변수 유지, 이미지는 글자만', async () => {
    const { spreadsheetDocToExportHtml } = await import('$lib/utils/docExport/exportHtml')
    const built = spreadsheetDocToExportHtml(DOC)
    expect(built.isEmpty).toBe(false)
    expect(built.droppedImages).toBe(true)
    expect(built.html).toContain('<table class="ss-table">')
    expect(built.html).toContain('{{고객명}}')
    expect(built.html).toContain('colspan="4"')
    expect(built.html).toContain('background-color:#FFFF00')
    expect(built.html).not.toContain('cs-image://')
  })
  it('스프레드시트 양식은 한글·워드로 저장할 수 없다', async () => {
    for (const f of ['hwp', 'hwpx', 'docx'] as const) {
      await expect(exportContractFile(f, { mode: 'spreadsheet', title: 't', spreadsheetDoc: DOC })).rejects.toThrow('저장할 수 없어요')
    }
  })
  it('csv·tsv: 현재 시트만, 따옴표·줄바꿈 처리, BOM, 이미지 표식 제거', async () => {
    const { spreadsheetToDelimitedBlob } = await import('$lib/utils/docExport/sheetFilesFromSpreadsheet')
    const csv = spreadsheetToDelimitedBlob(DOC, ',')
    const text = await csv.blob.text()
    expect([...new Uint8Array(await csv.blob.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]) // UTF-8 BOM
    expect(text).toContain('"줄1\n줄2"')
    expect(text).toContain('(인),')
    expect(text).not.toContain('cs-image://')
    expect(text).not.toContain('조항') // 2번째 시트는 제외
    expect(csv.warnings.join(' ')).toContain('시트 하나만')
    const tsv = await spreadsheetToDelimitedBlob({ ...DOC, activeSheetIndex: 1 }, '\t').blob.text()
    expect(tsv).toContain('조항')
    expect(spreadsheetToDelimitedBlob({ ...DOC, sheets: [{ name: 'S', rows: [['a,b', 'c"d']], merges: [], colWidths: [], cellFormatting: [] }] }, ',').blob.size).toBeGreaterThan(0)
  })
  it('ods: 시트·값·병합이 들어가고 다시 읽힌다', async () => {
    const { spreadsheetToOdsBlob } = await import('$lib/utils/docExport/sheetFilesFromSpreadsheet')
    const made = await spreadsheetToOdsBlob(DOC)
    const XLSX = await import('xlsx')
    const wb = XLSX.read(await made.blob.arrayBuffer(), { type: 'array' })
    expect(wb.SheetNames).toEqual(['계약서', '약관'])
    expect(wb.Sheets['계약서']['A1'].v).toBe('렌탈 계약서')
    expect(wb.Sheets['계약서']['!merges']).toHaveLength(1)
    expect(made.warnings.join(' ')).toContain('서식')
  })
  it('모든 칸이 비어 있으면 엑셀 외 형식 저장을 거절', async () => {
    const empty: SpreadsheetDocument = { activeSheetIndex: 0, sheets: [{ name: 'S', rows: [['', '']], merges: [], colWidths: [null, null], cellFormatting: [] }] }
    await expect(exportContractFile('csv', { mode: 'spreadsheet', title: 't', spreadsheetDoc: empty })).rejects.toThrow('비어 있습니다')
  })
  it('스프레드시트 내용이 없으면 거절', async () => {
    await expect(exportContractFile('xlsx', { mode: 'spreadsheet', title: 't', spreadsheetDoc: null })).rejects.toThrow('저장할 내용이 없습니다')
  })
})
