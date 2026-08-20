/**
 * spreadsheetWidgetAdapter.test.ts — 어댑터 단위 테스트
 *
 * 검증 대상:
 *  1. mergesToJss / jssMergesToSheet — 병합 anchor↔셀주소 변환
 *  2. sheetToWorksheetConfig — SpreadsheetSheet → jss 설정 변환
 *  3. worksheetConfigToSheet — WorksheetInstance 목업 → SpreadsheetSheet 변환
 *  4. sheetToWorksheetConfig → worksheetConfigToSheet 라운드트립
 *
 * DOM 미사용 (XLSX.utils는 순수 산술) — jsdom 환경 불필요.
 */

import { describe, it, expect } from 'vitest'
import {
  mergesToJss,
  jssMergesToSheet,
  sheetToWorksheetConfig,
  worksheetConfigToSheet,
  type JssWorksheetInstance,
} from '$lib/components/cms/contract-editor/spreadsheetWidgetAdapter'
import type { SpreadsheetSheet } from '$lib/types/contract-document'
import type { SheetMergeRange } from '$lib/types/sheet-format'

// ─────────────────────────────────────────────────────────────────────────────
// 헬퍼: WorksheetInstance 목업 생성
// ─────────────────────────────────────────────────────────────────────────────

function makeWs(options: {
  data?: (string | number | boolean)[][]
  merges?: Record<string, [number, number]>
  widths?: (number | string)[]
  styles?: Record<string, string>
}): JssWorksheetInstance {
  return {
    getData: () => options.data ?? [],
    getMerge: () => options.merges ?? {},
    getWidth: () => options.widths ?? [],
    getStyle: () => options.styles ?? {},
    // 이 테스트 스위트에서는 worksheetConfigToSheet()(저장 시 역변환)만 검증한다 —
    // insertTextAtSelection()의 선택/셀입력 경로는 별도 목업 없이 아래 메서드로 충분.
    getSelection: () => [0, 0, 0, 0],
    getValueFromCoords: () => null,
    setValueFromCoords: () => {},
    setWidth: () => {},
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 병합 anchor↔셀주소 변환
// ─────────────────────────────────────────────────────────────────────────────

describe('mergesToJss', () => {
  it('SheetMergeRange를 [colspan, rowspan] 레코드로 변환한다', () => {
    const merges: SheetMergeRange[] = [
      { s: { r: 0, c: 0 }, e: { r: 1, c: 2 } }, // A1, colspan=3, rowspan=2
      { s: { r: 2, c: 1 }, e: { r: 2, c: 3 } }, // B3, colspan=3, rowspan=1
    ]
    const result = mergesToJss(merges)
    expect(result['A1']).toEqual([3, 2])
    expect(result['B3']).toEqual([3, 1])
  })

  it('빈 배열이면 빈 레코드를 반환한다', () => {
    expect(mergesToJss([])).toEqual({})
  })

  it('1×1 범위도 변환한다', () => {
    const merges: SheetMergeRange[] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }]
    const result = mergesToJss(merges)
    expect(result['A1']).toEqual([1, 1])
  })

  it('비정상 범위(e<s)는 스킵한다', () => {
    const merges: SheetMergeRange[] = [{ s: { r: 2, c: 0 }, e: { r: 0, c: 0 } }]
    expect(mergesToJss(merges)).toEqual({})
  })
})

describe('jssMergesToSheet', () => {
  it('셀주소 레코드를 SheetMergeRange[]로 변환한다', () => {
    const record: Record<string, [number, number]> = {
      A1: [3, 2], // A1: colspan=3, rowspan=2 → s:(0,0) e:(1,2)
      B3: [3, 1], // B3: colspan=3, rowspan=1 → s:(2,1) e:(2,3)
    }
    const result = jssMergesToSheet(record)
    const a1 = result.find((m) => m.s.r === 0 && m.s.c === 0)
    const b3 = result.find((m) => m.s.r === 2 && m.s.c === 1)
    expect(a1).toEqual({ s: { r: 0, c: 0 }, e: { r: 1, c: 2 } })
    expect(b3).toEqual({ s: { r: 2, c: 1 }, e: { r: 2, c: 3 } })
  })

  it('빈 레코드면 빈 배열을 반환한다', () => {
    expect(jssMergesToSheet({})).toEqual([])
  })
})

describe('병합 라운드트립 (SheetMergeRange → jss → SheetMergeRange)', () => {
  it('복수 병합이 왕복 변환 후 동일하다', () => {
    const originals: SheetMergeRange[] = [
      { s: { r: 0, c: 0 }, e: { r: 2, c: 3 } },
      { s: { r: 1, c: 4 }, e: { r: 3, c: 5 } },
      { s: { r: 5, c: 0 }, e: { r: 5, c: 9 } },
    ]
    const jss = mergesToJss(originals)
    const roundTrip = jssMergesToSheet(jss)

    for (const orig of originals) {
      const match = roundTrip.find(
        (m) =>
          m.s.r === orig.s.r &&
          m.s.c === orig.s.c &&
          m.e.r === orig.e.r &&
          m.e.c === orig.e.c,
      )
      expect(match).toBeDefined()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// sheetToWorksheetConfig
// ─────────────────────────────────────────────────────────────────────────────

const baseSheet: SpreadsheetSheet = {
  name: '계약서',
  rows: [
    ['제목', '내용', '비고'],
    ['데이터1', '데이터2', '데이터3'],
  ],
  merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }],
  colWidths: [100, 200, 150],
  cellFormatting: [
    [{ backgroundColor: '#FF0000' }, {}, {}],
    [{}, { borderColor: '#000000' }, {}],
  ],
}

describe('sheetToWorksheetConfig', () => {
  it('worksheetName이 시트 이름으로 설정된다', () => {
    const config = sheetToWorksheetConfig(baseSheet)
    expect(config.worksheetName).toBe('계약서')
  })

  it('data가 rows와 동일하게 설정된다', () => {
    const config = sheetToWorksheetConfig(baseSheet)
    expect(config.data).toEqual(baseSheet.rows)
  })

  it('A1 병합이 [colspan=2, rowspan=1]로 변환된다', () => {
    const config = sheetToWorksheetConfig(baseSheet)
    expect(config.mergeCells['A1']).toEqual([2, 1])
  })

  it('columns 배열이 colWidths 개수와 일치한다', () => {
    const config = sheetToWorksheetConfig(baseSheet)
    expect(config.columns.length).toBe(3)
  })

  it('A1 배경색이 CSS style 레코드에 포함된다', () => {
    const config = sheetToWorksheetConfig(baseSheet)
    expect(config.style['A1']).toContain('background-color: #FF0000')
  })

  it('B2 테두리색이 CSS style 레코드에 포함된다', () => {
    const config = sheetToWorksheetConfig(baseSheet)
    expect(config.style['B2']).toContain('border: 1px solid #000000')
  })

  it('서식 없는 셀은 style 레코드에 키가 없다', () => {
    const config = sheetToWorksheetConfig(baseSheet)
    expect(config.style['C1']).toBeUndefined()
    expect(config.style['A2']).toBeUndefined()
  })

  it('폰트색·굵기·크기가 CSS style 레코드에 포함된다 (2026-08-20)', () => {
    const sheetWithFont: SpreadsheetSheet = {
      ...baseSheet,
      cellFormatting: [
        [{ color: 'rgb(255, 255, 255)', fontWeight: 'bold', fontSize: 'large' }, {}, {}],
        [{}, {}, {}],
      ],
    }
    const config = sheetToWorksheetConfig(sheetWithFont)
    expect(config.style['A1']).toContain('color: rgb(255, 255, 255)')
    expect(config.style['A1']).toContain('font-weight: bold')
    expect(config.style['A1']).toContain('font-size: large')
  })

  it('합계 colWidths > 642px 이면 columns 너비 합이 642 이하로 축소된다', () => {
    const wideSheet: SpreadsheetSheet = {
      ...baseSheet,
      colWidths: [300, 300, 300], // 합계 900px > 642px
    }
    const config = sheetToWorksheetConfig(wideSheet)
    const total = config.columns.reduce((s, col) => s + col.width, 0)
    expect(total).toBeLessThanOrEqual(642)
  })

  it('합계 colWidths ≤ 642px 이면 columns 너비가 그대로 유지된다', () => {
    const config = sheetToWorksheetConfig(baseSheet) // 100+200+150=450 ≤ 642
    const widths = config.columns.map((c) => c.width)
    expect(widths).toEqual([100, 200, 150])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// worksheetConfigToSheet
// ─────────────────────────────────────────────────────────────────────────────

describe('worksheetConfigToSheet', () => {
  it('getData 결과가 string[][] rows로 변환된다', () => {
    const ws = makeWs({ data: [['A', 'B'], [1, false]], widths: [100, 100] })
    const sheet = worksheetConfigToSheet('시트1', ws)
    expect(sheet.rows).toEqual([['A', 'B'], ['1', 'false']])
  })

  it('null 셀은 빈 문자열로 변환된다', () => {
    const ws = makeWs({
      data: [['A', null as unknown as string]],
      widths: [100, 100],
    })
    const sheet = worksheetConfigToSheet('시트1', ws)
    expect(sheet.rows[0][1]).toBe('')
  })

  it('getMerge 결과가 SheetMergeRange[]로 변환된다', () => {
    const ws = makeWs({
      data: [['A', 'B', 'C']],
      merges: { A1: [2, 1] },
      widths: [100, 100, 100],
    })
    const sheet = worksheetConfigToSheet('시트1', ws)
    expect(sheet.merges).toHaveLength(1)
    expect(sheet.merges[0]).toEqual({ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } })
  })

  it('getWidth 숫자 배열이 colWidths로 변환된다', () => {
    const ws = makeWs({ data: [['A', 'B']], widths: [150, 200] })
    const sheet = worksheetConfigToSheet('시트1', ws)
    expect(sheet.colWidths).toEqual([150, 200])
  })

  it('getWidth 문자열 배열도 숫자로 변환된다', () => {
    const ws = makeWs({ data: [['A']], widths: ['120'] })
    const sheet = worksheetConfigToSheet('시트1', ws)
    expect(sheet.colWidths[0]).toBe(120)
  })

  it('getStyle CSS에서 배경색이 파싱된다', () => {
    const ws = makeWs({
      data: [['A']],
      widths: [100],
      styles: { A1: 'background-color: #FFCC00' },
    })
    const sheet = worksheetConfigToSheet('시트1', ws)
    expect(sheet.cellFormatting[0][0].backgroundColor).toBe('#FFCC00')
  })

  it('getStyle CSS에서 테두리색이 파싱된다', () => {
    const ws = makeWs({
      data: [['A']],
      widths: [100],
      styles: { A1: 'border: 1px solid #333333' },
    })
    const sheet = worksheetConfigToSheet('시트1', ws)
    expect(sheet.cellFormatting[0][0].borderColor).toBe('#333333')
  })

  it('스타일 없는 셀은 빈 XlsxCellFormatting을 반환한다', () => {
    const ws = makeWs({ data: [['A']], widths: [100], styles: {} })
    const sheet = worksheetConfigToSheet('시트1', ws)
    expect(sheet.cellFormatting[0][0]).toEqual({})
  })

  it('getStyle CSS에서 폰트색·굵기·크기가 파싱된다 (2026-08-20 — jspreadsheet 네이티브 툴바 저장값)', () => {
    const ws = makeWs({
      data: [['A']],
      widths: [100],
      styles: { A1: 'background-color: rgb(38, 48, 64); color: rgb(255, 255, 255); font-weight: bold; font-size: large' },
    })
    const sheet = worksheetConfigToSheet('시트1', ws)
    expect(sheet.cellFormatting[0][0]).toEqual({
      backgroundColor: 'rgb(38, 48, 64)',
      color: 'rgb(255, 255, 255)',
      fontWeight: 'bold',
      fontSize: 'large',
    })
  })

  it('"color:" 파싱이 "background-color:" 값을 오매칭하지 않는다', () => {
    const ws = makeWs({
      data: [['A']],
      widths: [100],
      styles: { A1: 'background-color: rgb(38, 48, 64)' },
    })
    const sheet = worksheetConfigToSheet('시트1', ws)
    expect(sheet.cellFormatting[0][0].color).toBeUndefined()
    expect(sheet.cellFormatting[0][0].backgroundColor).toBe('rgb(38, 48, 64)')
  })

  it('name이 SpreadsheetSheet.name으로 그대로 전달된다', () => {
    const ws = makeWs({ data: [], merges: {}, widths: [], styles: {} })
    const sheet = worksheetConfigToSheet('테스트시트', ws)
    expect(sheet.name).toBe('테스트시트')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// sheetToWorksheetConfig → worksheetConfigToSheet 라운드트립
// ─────────────────────────────────────────────────────────────────────────────

describe('전체 라운드트립 (sheetToWorksheetConfig → worksheetConfigToSheet)', () => {
  it('rows/merges/name/배경색이 왕복 변환 후 유지된다', () => {
    const original: SpreadsheetSheet = {
      name: '계약',
      rows: [['이름', '주소'], ['홍길동', '서울']],
      merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }],
      colWidths: [150, 150],
      cellFormatting: [
        [{ backgroundColor: '#AABBCC' }, {}],
        [{}, {}],
      ],
    }

    const config = sheetToWorksheetConfig(original)

    // config.data, mergeCells, style, columns width를 그대로 돌려주는 목업
    const ws = makeWs({
      data: config.data as (string | number | boolean)[][],
      merges: config.mergeCells,
      widths: config.columns.map((c) => c.width),
      styles: config.style,
    })

    const result = worksheetConfigToSheet(original.name, ws)

    expect(result.name).toBe(original.name)
    expect(result.rows).toEqual(original.rows)
    expect(result.merges).toHaveLength(1)
    expect(result.merges[0].s).toEqual(original.merges[0].s)
    expect(result.merges[0].e).toEqual(original.merges[0].e)
    expect(result.cellFormatting[0][0].backgroundColor).toBe('#AABBCC')
  })
})
