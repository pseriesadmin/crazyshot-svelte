import { describe, it, expect } from 'vitest'
import {
  parseFormula, printFormula, tryParseFormula, computeWorkbook, adjustFormulaForEdit, adjustAddress,
  textToNumber, parseDateText, dateToSerial, isDateFormat, usesOnlySupportedFunctions, KOREAN_BUILTIN_FORMATS, formatNumber,
} from '$lib/utils/sheetFormula'

const sheetsOf = (...s: Array<{ name: string; raw: string[][]; numFmts?: Record<string, string> }>) => computeWorkbook(s)

describe('파서 — 읽고 다시 쓰기', () => {
  it('참조·범위·시트 한정자를 읽고 같은 뜻으로 다시 쓴다', () => {
    for (const f of ['=A1+B1', '=결과보고서!G3', "='필증 '!A1:B2", '=SUM(A1:B3,5)*2', '=IF(A1>0,"예","아니오")', '=$A$1+B$2', '=1+2*3', '=(1+2)*3', '=-A1^2', '=A1&"원"', '=25%*A1']) {
      const ast = parseFormula(f)
      const again = parseFormula(`=${printFormula(ast)}`)
      expect(printFormula(again)).toBe(printFormula(ast))
    }
    expect(printFormula(parseFormula("='필증 '!A1"))).toBe("'필증 '!A1")
    expect(printFormula(parseFormula('=(1+2)*3'))).toBe('(1+2)*3')
  })
  it('지원하지 않는 모양은 null (열 전체·이름·외부 통합 문서·배열)', () => {
    for (const f of ['=A:A', '=SUM(1:3)', '=[1]Sheet!A1', '=이름', '={1,2}', '=A1+', '=SUM(', '=1A']) expect(tryParseFormula(f)).toBeNull()
  })
  it('너무 깊게 중첩되거나 긴 수식은 거절', () => {
    expect(tryParseFormula('=' + '('.repeat(200) + '1' + ')'.repeat(200))).toBeNull()
    expect(tryParseFormula('=' + '1+'.repeat(5000) + '1')).toBeNull()
  })
  it('지원 함수 판정', () => {
    expect(usesOnlySupportedFunctions(parseFormula('=SUM(A1:A3)+IF(B1>0,1,2)'))).toBe(true)
    expect(usesOnlySupportedFunctions(parseFormula('=VLOOKUP(A1,B1:C3,2,0)'))).toBe(false)
  })
})

describe('계산 — 같은 시트', () => {
  it('사칙·우선순위·단항 마이너스', () => {
    const [r] = sheetsOf({ name: 'S', raw: [['2', '3', '=A1+B1*2', '=(A1+B1)*2', '=-A1^2', '=A1/0', '=A1^B1']] })
    expect(r.get('C1')).toBe('8')
    expect(r.get('D1')).toBe('10')
    expect(r.get('E1')).toBe('4') // 엑셀: -2^2 = 4
    expect(r.get('F1')).toBe('#DIV/0!')
    expect(r.get('G1')).toBe('8')
  })
  it('함수: 합계·평균·최대·최소·개수·반올림·조건', () => {
    const [r] = sheetsOf({ name: 'S', raw: [['10', '20', '30', '=SUM(A1:C1)', '=AVERAGE(A1:C1)', '=MAX(A1:C1)', '=MIN(A1:C1)', '=COUNT(A1:C1)', '=ROUND(2.567,1)', '=IF(A1>5,"큼","작음")']] })
    expect([...['D1', 'E1', 'F1', 'G1', 'H1', 'I1', 'J1']].map((a) => r.get(a))).toEqual(['60', '20', '30', '10', '3', '2.6', '큼'])
  })
  it('글자 함수와 연결', () => {
    const [r] = sheetsOf({ name: 'S', raw: [['금담빌딩', '=LEFT(A1,2)', '=LEN(A1)', '=A1&" 귀하"', '=UPPER("ab")']] })
    expect([r.get('B1'), r.get('C1'), r.get('D1'), r.get('E1')]).toEqual(['금담', '4', '금담빌딩 귀하', 'AB'])
  })
  it('보이는 글자 → 숫자: 쉼표·통화·퍼센트', () => {
    expect(textToNumber('1,200,000')).toBe(1200000)
    expect(textToNumber('₩1,200')).toBe(1200)
    expect(textToNumber('25.6%')).toBeCloseTo(0.256)
    expect(textToNumber('abc')).toBeNull()
    const [r] = sheetsOf({ name: 'S', raw: [['₩1,000', '25%', '=A1*B1']] })
    expect(r.get('C1')).toBe('250')
  })
  it('순환·오류 전파·빈 칸은 0', () => {
    const [r] = sheetsOf({ name: 'S', raw: [['=B1', '=A1', '=C2', '=Z9', '=A1+1', '=IFERROR(1/0,"대체")']] })
    expect(r.get('A1')).toBe('#CIRC!')
    expect(r.get('B1')).toBe('#CIRC!')
    expect(r.get('D1')).toBe('0')
    expect(r.get('E1')).toBe('#CIRC!')
    expect(r.get('F1')).toBe('대체')
  })
  it('지원하지 않는 함수는 #NAME?', () => {
    expect(sheetsOf({ name: 'S', raw: [['=FOO(1)']] })[0].get('A1')).toBe('#NAME?')
  })
})

describe('계산 — 시트 간 연결', () => {
  const book = [
    { name: '결과보고서', raw: [['', '', '금담빌딩', '', '', '', '2026.10.19', '', '', '', '', '', '', '', '90', '']] },
    { name: '필증 ', raw: [["='결과보고서'!C1", '=결과보고서!G1', '=결과보고서!G1+181', '=SUM(결과보고서!O1,10)', "='없는시트'!A1", "='필증 '!A1&'!'"]] },
  ]
  it('다른 시트 칸을 그대로 가져온다(글자·숫자)', () => {
    const [, r] = computeWorkbook(book.map((b) => ({ ...b, raw: b.raw.map((x) => [...x]) })) as never)
    expect(r.get('A1')).toBe('금담빌딩')
    expect(r.get('D1')).toBe('100')
    expect(r.get('E1')).toBe('#REF!')
  })
  it('값이 바뀌면 연결된 시트의 값도 바뀐다', () => {
    const edited = book.map((b) => ({ ...b, raw: b.raw.map((x) => [...x]) }))
    edited[0].raw[0][2] = '새빌딩'
    expect(computeWorkbook(edited)[1].get('A1')).toBe('새빌딩')
  })
  it('날짜 칸: 서식이 있으면 서식대로, 날짜 계산은 일련번호로', () => {
    const withFmt = book.map((b) => ({ ...b, raw: b.raw.map((x) => [...x]) })) as Array<{ name: string; raw: string[][]; numFmts?: Record<string, string> }>
    withFmt[1].numFmts = { B1: 'yyyy"년" mm"월" dd"일"', C1: 'yyyy\\.mm\\.dd' }
    const [, r] = computeWorkbook(withFmt)
    expect(r.get('B1')).toBe('2026년 10월 19일')
    expect(r.get('C1')).toBe('2027.04.18') // 2026-10-19 + 181일
  })
  it('날짜 도우미', () => {
    expect(dateToSerial(2026, 10, 19)).toBe(46314)
    expect(parseDateText('2026.10.19')).toBe(46314)
    expect(parseDateText('2026년 10월 19일')).toBe(46314)
    expect(parseDateText('2026.13.40')).toBeNull()
    expect(isDateFormat('yyyy"년" mm"월"')).toBe(true)
    expect(isDateFormat('#,##0')).toBe(false)
    expect(formatNumber(46314, KOREAN_BUILTIN_FORMATS[31])).toBe('2026년 10월 19일')
    expect(formatNumber(1234.5, '#,##0')).toBe('1,235')
  })
})

describe('행·열 삽입/삭제 — 수식 참조 보정', () => {
  const ins = (at: number, count = 1, axis: 'row' | 'col' = 'row') => ({ sheet: 'S', axis, op: 'insert' as const, at, count })
  const del = (at: number, count = 1, axis: 'row' | 'col' = 'row') => ({ sheet: 'S', axis, op: 'delete' as const, at, count })
  it('삽입: 지점 이후 참조가 밀리고 범위 안에 끼우면 늘어난다', () => {
    expect(adjustFormulaForEdit('=A1+A3', 'S', ins(1))).toBe('=A1+A4')
    expect(adjustFormulaForEdit('=SUM(A1:A3)', 'S', ins(1))).toBe('=SUM(A1:A4)')
    expect(adjustFormulaForEdit('=SUM(A2:A3)', 'S', ins(0))).toBe('=SUM(A3:A4)')
    expect(adjustFormulaForEdit('=B1', 'S', ins(1, 1, 'col'))).toBe('=C1')
  })
  it('삭제: 지워진 칸은 #REF!, 범위는 줄고 전부 지워지면 #REF!, 이후는 당겨진다', () => {
    expect(adjustFormulaForEdit('=A2+A5', 'S', del(1))).toBe('=#REF!+A4')
    expect(adjustFormulaForEdit('=SUM(A1:A5)', 'S', del(1, 2))).toBe('=SUM(A1:A3)')
    expect(adjustFormulaForEdit('=SUM(A2:A3)', 'S', del(1, 2))).toBe('=SUM(#REF!)')
  })
  it('다른 시트의 구조 변경은 그 시트를 가리키는 참조만 바꾼다', () => {
    expect(adjustFormulaForEdit('=A3', 'T', ins(0))).toBe('=A3') // 수식은 T 시트, 변경은 S 시트
    expect(adjustFormulaForEdit('=S!A3+A3', 'T', ins(0))).toBe('=S!A4+A3')
    expect(adjustFormulaForEdit("='S'!A3", 'T', ins(0))).toBe('=S!A4')
  })
  it('절대 참조도 구조 변경은 따라간다, 해석 못 하는 수식은 그대로', () => {
    expect(adjustFormulaForEdit('=$A$3', 'S', ins(0))).toBe('=$A$4')
    expect(adjustFormulaForEdit('=VLOOKUP(', 'S', ins(0))).toBe('=VLOOKUP(')
  })
  it('칸 주소 키 이동', () => {
    expect(adjustAddress('C3', ins(1))).toBe('C4')
    expect(adjustAddress('C3', del(2))).toBeNull()
    expect(adjustAddress('C3', del(0))).toBe('C2')
    expect(adjustAddress('C3', ins(0, 2, 'col'))).toBe('E3')
  })
})

describe('엑셀 가져오기 — 수식·시트 간 연결', () => {
  it('원본 수식을 연결 상태로 가져오고, 엑셀 값과 다르면 값만 남긴다', async () => {
    const ExcelJS = (await import('exceljs')).default
    const { importWorkbookWithStats } = await import('$lib/utils/docImport/xlsxToSpreadsheetDocument')
    const wb = new ExcelJS.Workbook()
    const a = wb.addWorksheet('앞')
    a.getCell('A1').value = '금담빌딩'
    a.getCell('B1').value = 10
    a.getCell('C1').value = 5
    const b = wb.addWorksheet('뒤 시트')
    b.getCell('A1').value = { formula: '앞!A1', result: '금담빌딩' }
    b.getCell('B1').value = { formula: "SUM(앞!B1:C1)", result: 15 }
    b.getCell('C1').value = { formula: 'VLOOKUP(1,A1:B2,2,0)', result: 7 } // 지원하지 않는 함수 → 가져오지 않음(값만)
    b.getCell('D1').value = { formula: 'B1*2', result: 99 } // 엑셀 값(99)과 엔진 값(30)이 다르면 값만 남긴다
    const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer
    const { doc, stats } = await importWorkbookWithStats(new File([buf], 'f.xlsx'))
    const s = doc.sheets[1]
    expect(s.formulas).toEqual({ A1: '=앞!A1', B1: '=SUM(앞!B1:C1)' })
    expect(s.rows[0].slice(0, 4)).toEqual(['금담빌딩', '15', '7', '99'])
    expect(stats).toEqual({ linked: 2, valueOnly: 1 })
  })
})
