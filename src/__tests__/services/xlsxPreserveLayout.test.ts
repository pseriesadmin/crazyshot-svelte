// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { importWorkbookAsSpreadsheetDocument } from '$lib/utils/docImport/xlsxToSpreadsheetDocument'
import { parseSheet } from '$lib/utils/docImport/xlsxImport'
import { sheetToWorksheetConfig, trimSheetToUsedRange } from '$lib/components/cms/contract-editor/spreadsheetWidgetAdapter'
import { renderSpreadsheetToHtml } from '$lib/utils/spreadsheetRender'
import { spreadsheetToXlsxBlob } from '$lib/utils/docExport/xlsxFromSpreadsheet'

/** 엑셀 원본과 비슷하게: 글자 수 단위 열 너비, 지정 행 높이, 빈 행, 색 없는(자동) 테두리, 병합 */
async function makeFile(): Promise<File> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('S')
  ws.getColumn(1).width = 2.58
  ws.getColumn(2).width = 4.58
  ws.getColumn(3).width = 26.91
  ws.getCell('A1').value = '제목'
  ws.getCell('C1').value = 'c'
  ws.getRow(1).height = 21
  ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  ws.getCell('C1').value = 1200000
  ws.getCell('A3').value = '내용'
  ws.getRow(3).height = 18.75
  ws.getCell('B3').value = 'x'
  // 2번·4번 행은 완전히 빈 행
  ws.getCell('A5').value = '병합'
  ws.mergeCells('A5:B6')
  ws.getCell('A3').border = { top: { style: 'thin' }, left: { style: 'medium' } } // 색 없음(자동)
  ws.getCell('B3').border = { bottom: { style: 'double' }, right: { style: 'dashed', color: { argb: 'FFFF0000' } } }
  // 병합 범위의 아래·오른쪽 테두리는 가장자리 칸이 가진다(엑셀 방식)
  ws.getCell('B6').border = { bottom: { style: 'thick' }, right: { style: 'thin' } }
  const buf = await wb.xlsx.writeBuffer()
  return new File([buf as ArrayBuffer], 'p.xlsx')
}

describe('xlsx 가져오기 — 원본 배치 보존(preserveLayout)', () => {
  it('열 너비를 글자 수 × 7px 로 환산하고 A4 축소를 하지 않는다', async () => {
    const doc = await importWorkbookAsSpreadsheetDocument(await makeFile())
    const w = doc.sheets[0].colWidths
    expect(w[0]).toBe(Math.round(2.58 * 7))
    expect(w[1]).toBe(Math.round(4.58 * 7))
    expect(w[2]).toBe(Math.round(26.91 * 7))
  })
  it('행 높이(pt→px)를 가져온다', async () => {
    const doc = await importWorkbookAsSpreadsheetDocument(await makeFile())
    const h = doc.sheets[0].rowHeights
    expect(h?.[0]).toBe(28) // 21pt
    expect(h?.[2]).toBe(25) // 18.75pt
  })
  it('빈 행을 지우지 않는다(원본 행 위치 유지)', async () => {
    const doc = await importWorkbookAsSpreadsheetDocument(await makeFile())
    const s = doc.sheets[0]
    expect(s.rows[2][0]).toBe('내용') // 3번째 줄 그대로
    expect(s.rows[4][0]).toBe('병합') // 빈 4번 행을 건너뛰지 않음
    expect(s.merges).toEqual([{ s: { r: 4, c: 0 }, e: { r: 5, c: 1 } }])
  })
  it('테두리를 변별 굵기·종류·색으로 가져온다(자동색=검정)', async () => {
    const f = (await importWorkbookAsSpreadsheetDocument(await makeFile())).sheets[0].cellFormatting
    expect(f[2][0].borderTop).toBe('1px solid #000000')
    expect(f[2][0].borderLeft).toBe('2px solid #000000')
    expect(f[2][1].borderBottom).toBe('3px double #000000')
    expect(f[2][1].borderRight).toBe('1px dashed #FF0000')
    expect(f[2][0].borderColor).toBeUndefined() // 사방 한 색 방식은 쓰지 않는다
  })
  it('병합 범위 가장자리 칸의 테두리를 앵커 칸으로 모은다', async () => {
    const f = (await importWorkbookAsSpreadsheetDocument(await makeFile())).sheets[0].cellFormatting
    expect(f[4][0].borderBottom).toBe('3px solid #000000')
    expect(f[4][0].borderRight).toBe('1px solid #000000')
  })
  it('정렬·줄바꿈: 명시한 값은 그대로, 정렬 없음은 글자 왼쪽·숫자 오른쪽, 줄바꿈 없는 칸은 wrapText=false', async () => {
    const f = (await importWorkbookAsSpreadsheetDocument(await makeFile())).sheets[0].cellFormatting
    // 가운데·가운데·줄바꿈 있음 → 줄바꿈 표시 없음(편집기 기본이 줄바꿈)
    expect(f[0][0].textAlign).toBe('center')
    expect(f[0][0].verticalAlign).toBe('middle')
    expect(f[0][0].wrapText).toBeUndefined()
    // 서식 없는 글자 칸 — 왼쪽·아래, 줄바꿈 없음
    expect(f[2][0].textAlign).toBe('left')
    expect(f[2][0].verticalAlign).toBe('bottom')
    expect(f[2][0].wrapText).toBe(false)
    // 숫자 칸 — 오른쪽
    expect(f[0][2].textAlign).toBe('right')
    // 빈 칸에는 정렬을 넣지 않는다
    expect(f[1][0].textAlign).toBeUndefined()
  })
  it('줄바꿈 없음은 편집기 스타일(넘침 허용)로 전달되고, 다시 읽으면 같은 값이다', async () => {
    const { cssToFormatting } = await import('$lib/components/cms/contract-editor/spreadsheetWidgetAdapter')
    const doc = await importWorkbookAsSpreadsheetDocument(await makeFile())
    const css = sheetToWorksheetConfig(doc.sheets[0]).style['A3']
    expect(css).toContain('white-space: nowrap')
    expect(css).toContain('overflow: visible')
    expect(cssToFormatting(css).wrapText).toBe(false)
  })
  it('엑셀로 내보낼 때 줄바꿈 없음이 유지된다', async () => {
    const doc = await importWorkbookAsSpreadsheetDocument(await makeFile())
    const { blob } = await spreadsheetToXlsxBlob(doc, 't')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await blob.arrayBuffer())
    expect(wb.getWorksheet('S')!.getCell('A3').alignment?.wrapText).toBeFalsy() // 줄바꿈 없음은 속성을 쓰지 않는다
    expect(wb.getWorksheet('S')!.getCell('A1').alignment?.wrapText).toBe(true)
  })
  it('기본 동작(문서형 표 가져오기)은 그대로 — 빈 행 제거·A4 축소', async () => {
    const data = await parseSheet(await makeFile(), { sheetName: 'S' })
    expect(data.rows.length).toBeLessThan(6) // 빈 행이 지워진다
    expect(data.rowHeights).toEqual([])
  })
})

describe('행 높이 — 편집기·저장·고객 화면·엑셀 내보내기', () => {
  it('편집기 설정에 단위가 붙은 높이로 전달된다', async () => {
    const doc = await importWorkbookAsSpreadsheetDocument(await makeFile())
    const cfg = sheetToWorksheetConfig(doc.sheets[0])
    expect(cfg.rows?.[0]).toEqual({ height: '28px' })
  })
  it('뒤쪽 빈칸 정리 시 행 높이도 같이 자른다', () => {
    const t = trimSheetToUsedRange({
      name: 'S', rows: [['a'], [''], ['']], merges: [], colWidths: [null], rowHeights: [20, 20, 20],
      cellFormatting: [[{}], [{}], [{}]],
    })
    expect(t.rows).toHaveLength(1)
    expect(t.rowHeights).toEqual([20])
  })
  it('고객 화면 표에 행 높이가 들어간다', async () => {
    const doc = await importWorkbookAsSpreadsheetDocument(await makeFile())
    expect(renderSpreadsheetToHtml(doc)).toContain('<tr style="height:28px">')
  })
  it('엑셀 내보내기에 행 높이(px→pt)가 들어가고 다시 가져와도 같다', async () => {
    const doc = await importWorkbookAsSpreadsheetDocument(await makeFile())
    const { blob } = await spreadsheetToXlsxBlob(doc, 't')
    const back = await importWorkbookAsSpreadsheetDocument(new File([await blob.arrayBuffer()], 'b.xlsx'))
    expect(back.sheets[0].rowHeights?.[0]).toBe(28)
    expect(back.sheets[0].rows[4][0]).toBe('병합')
  })
})

describe('글꼴·배경(테마색 포함) 가져오기', () => {
  async function fontFile(): Promise<File> {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('F')
    ws.getCell('A1').value = '제목'
    ws.getCell('A1').font = { name: '맑은 고딕', size: 16, bold: true, italic: true, underline: true, strike: true, color: { argb: 'FFFF0000' } }
    ws.getCell('B1').value = '테마'
    ws.getCell('B1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '', theme: 4, tint: 0.4 } as ExcelJS.Color }
    ws.getCell('C1').value = '일반'
    ws.getCell('D1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } } // 값 없는 칸의 배경
    return new File([(await wb.xlsx.writeBuffer()) as ArrayBuffer], 'f.xlsx')
  }
  it('글꼴 이름·크기·굵기·기울임·밑줄·취소선·색을 가져온다', async () => {
    const f = (await importWorkbookAsSpreadsheetDocument(await fontFile())).sheets[0].cellFormatting[0]
    expect(f[0].fontFamily).toBe('맑은 고딕')
    expect(f[0].fontSize).toBe('16pt')
    expect(f[0].fontWeight).toBe('bold')
    expect(f[0].fontStyle).toBe('italic')
    expect(f[0].textDecoration).toBe('underline line-through')
    expect(f[0].color).toBe('#FF0000')
  })
  it('기본 글꼴 칸도 크기·이름이 들어간다(원본과 같은 글자 크기)', async () => {
    const f = (await importWorkbookAsSpreadsheetDocument(await fontFile())).sheets[0].cellFormatting[0]
    expect(f[2].fontSize).toMatch(/pt$/)
    expect(f[2].fontWeight).toBeUndefined()
  })
  it('테마색 배경과 값 없는 칸의 배경을 가져온다', async () => {
    const f = (await importWorkbookAsSpreadsheetDocument(await fontFile())).sheets[0].cellFormatting[0]
    expect(f[1].backgroundColor).toMatch(/^#[0-9A-F]{6}$/)
    expect(f[3].backgroundColor).toBe('#FFFF00')
  })
})
