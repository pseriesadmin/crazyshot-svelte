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

  it('text-align이 CSS style 레코드에 포함된다 (2026-08-28 — CMS 실사용 중 발견, 정렬 툴바로 지정한 값이 저장 시 유실되던 문제)', () => {
    const sheetWithAlign: SpreadsheetSheet = {
      ...baseSheet,
      cellFormatting: [
        [{ textAlign: 'right' }, {}, {}],
        [{}, {}, {}],
      ],
    }
    const config = sheetToWorksheetConfig(sheetWithAlign)
    expect(config.style['A1']).toContain('text-align: right')
  })

  it('border-top/right/bottom/left이 CSS style 레코드에 각각 포함된다 (2026-08-28(같은 날 후속) — 테두리 툴바로 지정한 값이 저장 시 유실되던 문제)', () => {
    const sheetWithBorders: SpreadsheetSheet = {
      ...baseSheet,
      cellFormatting: [
        [
          {
            borderTop: '1px solid rgb(0, 0, 0)',
            borderRight: '2px dashed rgb(255, 0, 0)',
            borderBottom: '1px solid rgb(0, 0, 0)',
            borderLeft: '1px solid rgb(0, 0, 0)',
          },
          {},
          {},
        ],
        [{}, {}, {}],
      ],
    }
    const config = sheetToWorksheetConfig(sheetWithBorders)
    expect(config.style['A1']).toContain('border-top: 1px solid rgb(0, 0, 0)')
    expect(config.style['A1']).toContain('border-right: 2px dashed rgb(255, 0, 0)')
    expect(config.style['A1']).toContain('border-bottom: 1px solid rgb(0, 0, 0)')
    expect(config.style['A1']).toContain('border-left: 1px solid rgb(0, 0, 0)')
  })

  it('합계 colWidths > 642px 이어도 재계산 없이 원본 그대로 유지된다 (2026-08-27 — A4 자동축소는 가져오기 시점 1회만, 로드 시 재적용 안 함)', () => {
    const wideSheet: SpreadsheetSheet = {
      ...baseSheet,
      colWidths: [300, 300, 300], // 합계 900px > 642px
    }
    const config = sheetToWorksheetConfig(wideSheet)
    const widths = config.columns.map((c) => c.width)
    expect(widths).toEqual([300, 300, 300])
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

  it('getStyle CSS에서 text-align이 파싱된다 (2026-08-28 — 정렬 툴바 저장값 유실 수정)', () => {
    const ws = makeWs({
      data: [['A']],
      widths: [100],
      styles: { A1: 'text-align: right' },
    })
    const sheet = worksheetConfigToSheet('시트1', ws)
    expect(sheet.cellFormatting[0][0].textAlign).toBe('right')
  })

  it('getStyle CSS에서 border-top/right/bottom/left이 각각 파싱된다 (2026-08-28(같은 날 후속) — 테두리 툴바 저장값 유실 수정)', () => {
    const ws = makeWs({
      data: [['A']],
      widths: [100],
      styles: {
        A1: 'border-top: 1px solid rgb(0, 0, 0); border-right: 2px dashed rgb(255, 0, 0); border-bottom: 1px solid rgb(0, 0, 0); border-left: 1px solid rgb(0, 0, 0)',
      },
    })
    const sheet = worksheetConfigToSheet('시트1', ws)
    expect(sheet.cellFormatting[0][0].borderTop).toBe('1px solid rgb(0, 0, 0)')
    expect(sheet.cellFormatting[0][0].borderRight).toBe('2px dashed rgb(255, 0, 0)')
    expect(sheet.cellFormatting[0][0].borderBottom).toBe('1px solid rgb(0, 0, 0)')
    expect(sheet.cellFormatting[0][0].borderLeft).toBe('1px solid rgb(0, 0, 0)')
  })

  it('border-top만 지정돼도 다른 변은 undefined로 남는다(부분 테두리 정확히 구분)', () => {
    const ws = makeWs({
      data: [['A']],
      widths: [100],
      styles: { A1: 'border-top: 1px solid rgb(0, 0, 0)' },
    })
    const sheet = worksheetConfigToSheet('시트1', ws)
    expect(sheet.cellFormatting[0][0].borderTop).toBe('1px solid rgb(0, 0, 0)')
    expect(sheet.cellFormatting[0][0].borderRight).toBeUndefined()
    expect(sheet.cellFormatting[0][0].borderBottom).toBeUndefined()
    expect(sheet.cellFormatting[0][0].borderLeft).toBeUndefined()
  })

  it('border-width/border-style/border-color 축약형(브라우저 재직렬화) 3값도 4변으로 파싱된다 (2026-08-28(같은 날 3차 후속) — 이미 사방 테두리가 있던 셀에 한 변만 재지정하면 브라우저가 border-top: 같은 단일 선언 대신 이 축약형으로 재직렬화, 실사용 브라우저 자동화로 직접 확인된 회귀)', () => {
    const ws = makeWs({
      data: [['A']],
      widths: [100],
      styles: {
        // 3값: top='black', right·left='rgb(0,0,0)', bottom='rgb(0,0,0)'
        A1: 'border-width: 1px; border-style: solid; border-color: black rgb(0, 0, 0) rgb(0, 0, 0); border-image: initial;',
      },
    })
    const sheet = worksheetConfigToSheet('시트1', ws)
    expect(sheet.cellFormatting[0][0].borderTop).toBe('1px solid black')
    expect(sheet.cellFormatting[0][0].borderRight).toBe('1px solid rgb(0, 0, 0)')
    expect(sheet.cellFormatting[0][0].borderBottom).toBe('1px solid rgb(0, 0, 0)')
    expect(sheet.cellFormatting[0][0].borderLeft).toBe('1px solid rgb(0, 0, 0)')
  })

  it('border-color 축약형 4값이 top/right/bottom/left 순서로 정확히 매핑된다', () => {
    const ws = makeWs({
      data: [['A']],
      widths: [100],
      styles: {
        A1: 'border-width: 1px; border-style: solid; border-color: red green blue yellow;',
      },
    })
    const sheet = worksheetConfigToSheet('시트1', ws)
    expect(sheet.cellFormatting[0][0].borderTop).toBe('1px solid red')
    expect(sheet.cellFormatting[0][0].borderRight).toBe('1px solid green')
    expect(sheet.cellFormatting[0][0].borderBottom).toBe('1px solid blue')
    expect(sheet.cellFormatting[0][0].borderLeft).toBe('1px solid yellow')
  })

  it('border-top: 단일 선언과 border-color 축약형이 함께 있으면 단일 선언이 우선한다', () => {
    const ws = makeWs({
      data: [['A']],
      widths: [100],
      styles: {
        A1: 'border-top: 2px dashed red; border-width: 1px; border-style: solid; border-color: black rgb(0, 0, 0) rgb(0, 0, 0);',
      },
    })
    const sheet = worksheetConfigToSheet('시트1', ws)
    expect(sheet.cellFormatting[0][0].borderTop).toBe('2px dashed red')
    expect(sheet.cellFormatting[0][0].borderRight).toBe('1px solid rgb(0, 0, 0)')
  })

  it('통일 border shorthand의 non-solid 스타일(dashed 등)이 4변 모두에 반영된다 (2026-08-29 — 두께·선스타일을 먼저 지정한 뒤 사방 패턴을 적용하면 브라우저가 "border: 3px dashed black" 같은 단일 shorthand로 직렬화하는데, 기존 정규식이 "solid" 리터럴만 요구해 전부 유실되던 회귀. Stephen 실사용 재현)', () => {
    const ws = makeWs({
      data: [['A']],
      widths: [100],
      styles: { A1: 'text-align: center; background-color: rgb(255, 255, 255); border: 3px dashed black;' },
    })
    const sheet = worksheetConfigToSheet('시트1', ws)
    expect(sheet.cellFormatting[0][0].borderTop).toBe('3px dashed black')
    expect(sheet.cellFormatting[0][0].borderRight).toBe('3px dashed black')
    expect(sheet.cellFormatting[0][0].borderBottom).toBe('3px dashed black')
    expect(sheet.cellFormatting[0][0].borderLeft).toBe('3px dashed black')
  })

  it('통일 border shorthand — dotted/double 스타일도 정상 파싱된다', () => {
    const wsDotted = makeWs({
      data: [['A']], widths: [100],
      styles: { A1: 'border: 2px dotted rgb(255, 0, 0);' },
    })
    expect(worksheetConfigToSheet('s', wsDotted).cellFormatting[0][0].borderTop).toBe('2px dotted rgb(255, 0, 0)')

    const wsDouble = makeWs({
      data: [['A']], widths: [100],
      styles: { A1: 'border: 4px double #00ff00;' },
    })
    expect(worksheetConfigToSheet('s', wsDouble).cellFormatting[0][0].borderLeft).toBe('4px double #00ff00')
  })

  it('통일 border shorthand(solid)는 여전히 borderColor(레거시)도 함께 채운다(하위호환)', () => {
    const ws = makeWs({
      data: [['A']],
      widths: [100],
      styles: { A1: 'border: 1px solid #333333' },
    })
    const sheet = worksheetConfigToSheet('시트1', ws)
    expect(sheet.cellFormatting[0][0].borderColor).toBe('#333333')
    expect(sheet.cellFormatting[0][0].borderTop).toBe('1px solid #333333')
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
