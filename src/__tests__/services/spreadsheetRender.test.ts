/**
 * spreadsheetRender.test.ts — renderSpreadsheetToHtml() 단위 테스트
 *
 * DOM 미사용 순수 문자열 함수이므로 jsdom 환경 불필요.
 *
 * 검증 항목:
 *   1. 빈 문서 → 빈 문자열
 *   2. 단일 시트 기본 렌더링 (셀 텍스트, <table>, <td>)
 *   3. XSS 방지 — <script>, &, ", ', < 문자 이스케이프
 *   4. 병합 셀 — rowspan/colspan 적용, 덮인 셀 스킵
 *   5. 컬럼 너비 — <colgroup> + <col style="width:Npx">
 *   6. 셀 서식 — 배경색·테두리색 인라인 스타일
 *   7. CSS 색상 검증 — #RRGGBB 이외 값은 스타일에서 무시
 *   8. 멀티 시트 — page-break-before:always, 시트명 제목
 *   9. 시트명 XSS — 시트 이름도 이스케이프
 */

import { describe, it, expect } from 'vitest'
import { renderSpreadsheetToHtml } from '$lib/utils/spreadsheetRender'
import type { SpreadsheetDocument } from '$lib/types/contract-document'

// ─────────────────────────────────────────────────────────────────────────────
// 테스트 픽스처 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

function makeDoc(overrides?: Partial<SpreadsheetDocument>): SpreadsheetDocument {
  return {
    sheets: [
      {
        name: 'Sheet1',
        rows: [['A1', 'B1'], ['A2', 'B2']],
        merges: [],
        colWidths: [100, 200],
        cellFormatting: [[{}, {}], [{}, {}]],
      },
    ],
    activeSheetIndex: 0,
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. 빈 문서
// ─────────────────────────────────────────────────────────────────────────────

describe('renderSpreadsheetToHtml — 빈 문서', () => {
  it('시트가 0개이면 빈 문자열을 반환한다', () => {
    const doc: SpreadsheetDocument = { sheets: [], activeSheetIndex: 0 }
    expect(renderSpreadsheetToHtml(doc)).toBe('')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. 단일 시트 기본 렌더링
// ─────────────────────────────────────────────────────────────────────────────

describe('renderSpreadsheetToHtml — 단일 시트', () => {
  it('<table class="ss-table">와 <td> 태그를 포함한다', () => {
    const html = renderSpreadsheetToHtml(makeDoc())
    expect(html).toContain('<table class="ss-table">')
    expect(html).toContain('<td>')
  })

  it('셀 텍스트가 출력된다', () => {
    const html = renderSpreadsheetToHtml(makeDoc())
    expect(html).toContain('A1')
    expect(html).toContain('B2')
  })

  it('<div class="ss-sheet-page"> 래퍼로 감싼다', () => {
    const html = renderSpreadsheetToHtml(makeDoc())
    expect(html).toContain('<div class="ss-sheet-page">')
  })

  it('<h4 class="ss-sheet-name">에 시트 이름을 표시한다', () => {
    const html = renderSpreadsheetToHtml(makeDoc())
    expect(html).toContain('<h4 class="ss-sheet-name">Sheet1</h4>')
  })

  it('단일 시트는 page-break-before 없음', () => {
    const html = renderSpreadsheetToHtml(makeDoc())
    expect(html).not.toContain('page-break-before')
  })

  it('행이 0개인 시트는 빈 <table>을 출력한다', () => {
    const doc: SpreadsheetDocument = {
      sheets: [{ name: 'Empty', rows: [], merges: [], colWidths: [], cellFormatting: [] }],
      activeSheetIndex: 0,
    }
    const html = renderSpreadsheetToHtml(doc)
    expect(html).toContain('<table class="ss-table">')
    expect(html).not.toContain('<td>')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. XSS 방지 — 셀 텍스트 이스케이프
// ─────────────────────────────────────────────────────────────────────────────

describe('renderSpreadsheetToHtml — XSS 방지', () => {
  it('<script> 태그는 이스케이프되어 렌더링된다', () => {
    const doc = makeDoc({
      sheets: [{
        name: 'Sheet1',
        rows: [['<script>alert(1)</script>']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{}]],
      }],
    })
    const html = renderSpreadsheetToHtml(doc)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;/script&gt;')
  })

  it('& 는 &amp;로 이스케이프된다', () => {
    const doc = makeDoc({
      sheets: [{
        name: 'Sheet1',
        rows: [['A & B']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{}]],
      }],
    })
    const html = renderSpreadsheetToHtml(doc)
    expect(html).toContain('A &amp; B')
    expect(html).not.toContain('A & B')
  })

  it('" 는 &quot;로 이스케이프된다', () => {
    const doc = makeDoc({
      sheets: [{
        name: 'Sheet1',
        rows: [['say "hello"']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{}]],
      }],
    })
    const html = renderSpreadsheetToHtml(doc)
    expect(html).toContain('say &quot;hello&quot;')
  })

  it("' 는 &#39;로 이스케이프된다", () => {
    const doc = makeDoc({
      sheets: [{
        name: 'Sheet1',
        rows: [["it's"]],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{}]],
      }],
    })
    const html = renderSpreadsheetToHtml(doc)
    expect(html).toContain("&#39;")
  })

  it('> 는 &gt;로 이스케이프된다', () => {
    const doc = makeDoc({
      sheets: [{
        name: 'Sheet1',
        rows: [['1 > 0']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{}]],
      }],
    })
    const html = renderSpreadsheetToHtml(doc)
    expect(html).toContain('1 &gt; 0')
  })

  it('XSS 페이로드 img 태그가 실행 불가하게 이스케이프된다', () => {
    const doc = makeDoc({
      sheets: [{
        name: 'Sheet1',
        rows: [['"><img src=x onerror=alert(1)>']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{}]],
      }],
    })
    const html = renderSpreadsheetToHtml(doc)
    // <img 태그가 실제 HTML 태그로 삽입되지 않아야 함 (이스케이프 확인)
    expect(html).not.toContain('<img ')
    // 이스케이프된 &lt;img 는 존재해야 함 (텍스트로만 표시)
    expect(html).toContain('&lt;img')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. 병합 셀
// ─────────────────────────────────────────────────────────────────────────────

describe('renderSpreadsheetToHtml — 병합 셀', () => {
  it('앵커 셀에 colspan 속성이 붙는다', () => {
    const doc: SpreadsheetDocument = {
      sheets: [{
        name: 'Sheet1',
        rows: [['병합', '', '단독']],
        merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }],
        colWidths: [null, null, null],
        cellFormatting: [[{}, {}, {}]],
      }],
      activeSheetIndex: 0,
    }
    const html = renderSpreadsheetToHtml(doc)
    expect(html).toContain('colspan="2"')
    expect(html).toContain('병합')
    // 덮인 셀(B1)은 <td>가 생성되지 않아야 함 — 단독 포함 td가 2개여야 함
    const tdMatches = html.match(/<td/g) ?? []
    expect(tdMatches.length).toBe(2) // 앵커 + 단독
  })

  it('앵커 셀에 rowspan 속성이 붙는다', () => {
    const doc: SpreadsheetDocument = {
      sheets: [{
        name: 'Sheet1',
        rows: [['세로병합', 'B1'], ['', 'B2']],
        merges: [{ s: { r: 0, c: 0 }, e: { r: 1, c: 0 } }],
        colWidths: [null, null],
        cellFormatting: [[{}, {}], [{}, {}]],
      }],
      activeSheetIndex: 0,
    }
    const html = renderSpreadsheetToHtml(doc)
    expect(html).toContain('rowspan="2"')
  })

  it('병합이 없으면 rowspan·colspan 속성이 없다', () => {
    const html = renderSpreadsheetToHtml(makeDoc())
    expect(html).not.toContain('rowspan')
    expect(html).not.toContain('colspan')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. 컬럼 너비
// ─────────────────────────────────────────────────────────────────────────────

describe('renderSpreadsheetToHtml — 컬럼 너비', () => {
  it('<colgroup>과 <col style="width:Npx"> 를 출력한다', () => {
    const html = renderSpreadsheetToHtml(makeDoc())
    expect(html).toContain('<colgroup>')
    expect(html).toContain('width:100px')
    expect(html).toContain('width:200px')
  })

  it('null 너비 컬럼은 <col>(width 없음)로 출력된다', () => {
    const doc = makeDoc({
      sheets: [{
        name: 'Sheet1',
        rows: [['A']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{}]],
      }],
    })
    const html = renderSpreadsheetToHtml(doc)
    expect(html).toContain('<colgroup>')
    expect(html).toContain('<col>')
    expect(html).not.toContain('width:0px')
  })

  it('합계가 A4 폭(642px) 초과 시 축소된다', () => {
    // 각 400px × 3컬럼 = 1200px → A4(642px)에 맞게 축소해야 함
    const doc: SpreadsheetDocument = {
      sheets: [{
        name: 'Sheet1',
        rows: [['A', 'B', 'C']],
        merges: [],
        colWidths: [400, 400, 400],
        cellFormatting: [[{}, {}, {}]],
      }],
      activeSheetIndex: 0,
    }
    const html = renderSpreadsheetToHtml(doc)
    // 각 컬럼이 400px 이하여야 함 (축소됨)
    expect(html).not.toContain('width:400px')
    // <col style= 이 3개 있어야 함
    const colMatches = html.match(/width:\d+px/g) ?? []
    expect(colMatches.length).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. 셀 서식 — 배경색·테두리색
// ─────────────────────────────────────────────────────────────────────────────

describe('renderSpreadsheetToHtml — 셀 서식', () => {
  it('배경색이 인라인 style로 출력된다', () => {
    const doc: SpreadsheetDocument = {
      sheets: [{
        name: 'Sheet1',
        rows: [['색상 셀']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{ backgroundColor: '#FF0000' }]],
      }],
      activeSheetIndex: 0,
    }
    const html = renderSpreadsheetToHtml(doc)
    expect(html).toContain('background-color:#FF0000')
  })

  it('테두리색이 인라인 style로 출력된다', () => {
    const doc: SpreadsheetDocument = {
      sheets: [{
        name: 'Sheet1',
        rows: [['테두리 셀']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{ borderColor: '#000000' }]],
      }],
      activeSheetIndex: 0,
    }
    const html = renderSpreadsheetToHtml(doc)
    expect(html).toContain('border:1px solid #000000')
  })

  it('배경색 + 테두리색 동시 적용', () => {
    const doc: SpreadsheetDocument = {
      sheets: [{
        name: 'Sheet1',
        rows: [['복합 셀']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{ backgroundColor: '#FFFF00', borderColor: '#333333' }]],
      }],
      activeSheetIndex: 0,
    }
    const html = renderSpreadsheetToHtml(doc)
    expect(html).toContain('background-color:#FFFF00')
    expect(html).toContain('border:1px solid #333333')
  })

  it('서식이 없는 셀에는 <td style=> 속성이 없다', () => {
    const html = renderSpreadsheetToHtml(makeDoc())
    // makeDoc의 모든 셀은 {}(서식 없음) — <td>에 style= 없어야 함
    // (<col style="width:Npx"> 는 존재할 수 있음)
    expect(html).not.toContain('<td style=')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. CSS 색상 검증
// ─────────────────────────────────────────────────────────────────────────────

describe('renderSpreadsheetToHtml — CSS 색상 검증', () => {
  it('#RRGGBB 이외의 색상값은 style에 포함하지 않는다', () => {
    const doc: SpreadsheetDocument = {
      sheets: [{
        name: 'Sheet1',
        rows: [['악의적 셀']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{ backgroundColor: 'javascript:alert(1)', borderColor: 'red; background:url(evil)' }]],
      }],
      activeSheetIndex: 0,
    }
    const html = renderSpreadsheetToHtml(doc)
    expect(html).not.toContain('javascript')
    expect(html).not.toContain('alert')
    expect(html).not.toContain('style=')
  })

  it('#RRGGBB 대소문자 모두 허용', () => {
    const doc: SpreadsheetDocument = {
      sheets: [{
        name: 'Sheet1',
        rows: [['대소문자']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{ backgroundColor: '#aAbBcC' }]],
      }],
      activeSheetIndex: 0,
    }
    const html = renderSpreadsheetToHtml(doc)
    expect(html).toContain('background-color:#aAbBcC')
  })

  it('#RGB(3자리) 포맷은 허용하지 않는다', () => {
    const doc: SpreadsheetDocument = {
      sheets: [{
        name: 'Sheet1',
        rows: [['3자리 색상']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{ backgroundColor: '#fff' }]],
      }],
      activeSheetIndex: 0,
    }
    const html = renderSpreadsheetToHtml(doc)
    expect(html).not.toContain('background-color')
  })

  // 2026-08-20: jspreadsheet-ce 네이티브 툴바로 지정한 배경색은 getStyle()이 'rgb(r, g, b)'
  // 형식으로 돌려준다(Production DB 직접 조회로 확인) — 이전엔 헥스만 허용해 이 형식이
  // 통째로 드롭되며 배경색이 고객 화면에서 감쪽같이 사라졌다.
  it('rgb(r, g, b) 형식 배경색을 허용한다', () => {
    const doc: SpreadsheetDocument = {
      sheets: [{
        name: 'Sheet1',
        rows: [['rgb 배경']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{ backgroundColor: 'rgb(38, 48, 64)' }]],
      }],
      activeSheetIndex: 0,
    }
    const html = renderSpreadsheetToHtml(doc)
    expect(html).toContain('background-color:rgb(38, 48, 64)')
  })

  it('rgba(r, g, b, a) 형식 색상을 허용한다', () => {
    const doc: SpreadsheetDocument = {
      sheets: [{
        name: 'Sheet1',
        rows: [['rgba 배경']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{ backgroundColor: 'rgba(38, 48, 64, 0.5)' }]],
      }],
      activeSheetIndex: 0,
    }
    const html = renderSpreadsheetToHtml(doc)
    expect(html).toContain('background-color:rgba(38, 48, 64, 0.5)')
  })

  it('악의적 rgb() 유사 값은 허용하지 않는다', () => {
    const doc: SpreadsheetDocument = {
      sheets: [{
        name: 'Sheet1',
        rows: [['악의적 rgb']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{ backgroundColor: 'rgb(0,0,0); background:url(javascript:alert(1))' }]],
      }],
      activeSheetIndex: 0,
    }
    const html = renderSpreadsheetToHtml(doc)
    expect(html).not.toContain('javascript')
    expect(html).not.toContain('style=')
  })

  it('폰트색·굵기·크기가 인라인 style로 출력된다', () => {
    const doc: SpreadsheetDocument = {
      sheets: [{
        name: 'Sheet1',
        rows: [['폰트 서식']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{ color: 'rgb(255, 255, 255)', fontWeight: 'bold', fontSize: 'large' }]],
      }],
      activeSheetIndex: 0,
    }
    const html = renderSpreadsheetToHtml(doc)
    expect(html).toContain('color:rgb(255, 255, 255)')
    expect(html).toContain('font-weight:bold')
    expect(html).toContain('font-size:large')
  })

  it('허용되지 않는 font-weight/font-size 값은 무시한다', () => {
    const doc: SpreadsheetDocument = {
      sheets: [{
        name: 'Sheet1',
        rows: [['악의적 폰트값']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{ fontWeight: 'expression(alert(1))', fontSize: '10px; background:url(x)' }]],
      }],
      activeSheetIndex: 0,
    }
    const html = renderSpreadsheetToHtml(doc)
    expect(html).not.toContain('expression')
    expect(html).not.toContain('style=')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 8. 멀티 시트
// ─────────────────────────────────────────────────────────────────────────────

describe('renderSpreadsheetToHtml — 멀티 시트', () => {
  const multiDoc: SpreadsheetDocument = {
    sheets: [
      {
        name: '첫번째',
        rows: [['R1C1']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{}]],
      },
      {
        name: '두번째',
        rows: [['R2C1']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{}]],
      },
      {
        name: '세번째',
        rows: [['R3C1']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{}]],
      },
    ],
    activeSheetIndex: 0,
  }

  it('두번째 시트부터 page-break-before:always가 붙는다', () => {
    const html = renderSpreadsheetToHtml(multiDoc)
    const breakCount = (html.match(/page-break-before:always/g) ?? []).length
    expect(breakCount).toBe(2) // 2번째, 3번째 시트
  })

  it('첫번째 시트에는 page-break-before가 없다', () => {
    const html = renderSpreadsheetToHtml(multiDoc)
    // 첫번째 <div class="ss-sheet-page"> 에는 style 없음
    expect(html).toMatch(/^<div class="ss-sheet-page">/)
  })

  it('각 시트에 시트 이름 제목이 출력된다', () => {
    const html = renderSpreadsheetToHtml(multiDoc)
    expect(html).toContain('첫번째')
    expect(html).toContain('두번째')
    expect(html).toContain('세번째')
  })

  it('각 시트의 셀 데이터가 모두 포함된다', () => {
    const html = renderSpreadsheetToHtml(multiDoc)
    expect(html).toContain('R1C1')
    expect(html).toContain('R2C1')
    expect(html).toContain('R3C1')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 9. 시트명 XSS
// ─────────────────────────────────────────────────────────────────────────────

describe('renderSpreadsheetToHtml — 시트명 XSS', () => {
  it('시트 이름에 HTML 태그가 있으면 이스케이프된다', () => {
    const doc: SpreadsheetDocument = {
      sheets: [{
        name: '<script>evil()</script>',
        rows: [['셀']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{}]],
      }],
      activeSheetIndex: 0,
    }
    const html = renderSpreadsheetToHtml(doc)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('시트 이름에 & 문자가 있으면 &amp;로 이스케이프된다', () => {
    const doc: SpreadsheetDocument = {
      sheets: [{
        name: '계약 & 서명',
        rows: [['셀']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{}]],
      }],
      activeSheetIndex: 0,
    }
    const html = renderSpreadsheetToHtml(doc)
    expect(html).toContain('계약 &amp; 서명')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 10. 이미지 오버레이 셀(서명/직인) — cs-image:// 마커 렌더링 (2026-08-16)
//     원본 텍스트를 지우지 않고 그 위에 이미지를 겹쳐 그린다(도장 개념).
// ─────────────────────────────────────────────────────────────────────────────

describe('renderSpreadsheetToHtml — 이미지 오버레이 셀(서명/직인)', () => {
  it('마커 앞의 원본 텍스트는 유지되고, 그 뒤에 <img> 오버레이가 추가된다', () => {
    const doc = makeDoc({
      sheets: [{
        name: 'Sheet1',
        rows: [['(인)cs-image://https://storage.example.com/sig/a.png', '']],
        merges: [],
        colWidths: [null, null],
        cellFormatting: [[{}, {}]],
      }],
    })
    const html = renderSpreadsheetToHtml(doc)
    // 원본 텍스트가 지워지지 않고 그대로 남아있어야 함
    expect(html).toContain('(인)')
    // 마커에 너비/오프셋이 없으면 각각 기본값(200px, 중앙=오프셋 0,0)으로 렌더링됨
    expect(html).toContain('<img src="https://storage.example.com/sig/a.png" alt="서명/직인" class="ss-cell-image" style="width:200px;transform:translate(calc(-50% + 0px), calc(-50% + 0px))" />')
    expect(html).not.toContain('cs-image://')
  })

  it('마커에 인코딩된 이동 오프셋(드래그 위치)이 <img> 인라인 transform으로 적용된다', () => {
    const doc = makeDoc({
      sheets: [{
        name: 'Sheet1',
        rows: [['텍스트cs-image://200:15:-30:https://storage.example.com/sig/a.png']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{}]],
      }],
    })
    const html = renderSpreadsheetToHtml(doc)
    expect(html).toContain('transform:translate(calc(-50% + 15px), calc(-50% + -30px))')
  })

  it('오버레이가 있는 셀은 <td>에 position:relative가 부여된다(절대위치 겹침 기준점)', () => {
    const doc = makeDoc({
      sheets: [{
        name: 'Sheet1',
        rows: [['텍스트cs-image://https://storage.example.com/sig/a.png']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{}]],
      }],
    })
    const html = renderSpreadsheetToHtml(doc)
    expect(html).toContain('position:relative')
  })

  it('오버레이가 있는 셀에는 이미지 높이만큼의 투명 스페이서가 함께 렌더링된다(행이 이미지를 담을 만큼 늘어나 인접 행 침범 방지, 2026-08-19 — <td>의 min-height는 테이블 레이아웃에서 무시되는 브라우저 동작이라 정상흐름 스페이서로 대체)', () => {
    const doc = makeDoc({
      sheets: [{
        name: 'Sheet1',
        rows: [['텍스트cs-image://https://storage.example.com/sig/a.png']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{}]],
      }],
    })
    const html = renderSpreadsheetToHtml(doc)
    // colWidths가 null(축소 없음)이라 safeWidth는 기본값 200 그대로 → 스페이서 높이도 200
    expect(html).toContain('<span aria-hidden="true" style="display:block;width:1px;height:200px"></span>')
  })

  it('스페이서 높이도 컬럼 A4 축소 비율만큼 이미지 폭과 동일하게 스케일된다', () => {
    const doc = makeDoc({
      sheets: [{
        name: 'Sheet1',
        rows: [['텍스트cs-image://400:0:0:https://storage.example.com/sig/a.png', '', '']],
        merges: [],
        colWidths: [500, 500, 500], // 합계 1500px — A4 목표폭(642px) 초과 → 비례 축소 발생
        cellFormatting: [[{}, {}, {}]],
      }],
    })
    const html = renderSpreadsheetToHtml(doc)
    // 컬럼 500px→214px(scale≈0.428) 이므로 이미지 폭 400px→171px, 스페이서 높이도 동일하게 171px
    expect(html).toContain('width:171px')
    expect(html).toContain('<span aria-hidden="true" style="display:block;width:1px;height:171px"></span>')
  })

  it('마커에 인코딩된 너비(문서형 크기설정 바 프리셋)가 <img> 인라인 width로 적용된다', () => {
    const doc = makeDoc({
      sheets: [{
        name: 'Sheet1',
        rows: [['텍스트cs-image://400:https://storage.example.com/sig/a.png']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{}]],
      }],
    })
    const html = renderSpreadsheetToHtml(doc)
    expect(html).toContain('width:400px')
  })

  it('마커 너비가 min/max 범위를 벗어나면 안전한 범위로 clamp된다', () => {
    const doc = makeDoc({
      sheets: [{
        name: 'Sheet1',
        rows: [
          ['텍스트cs-image://5:https://storage.example.com/sig/a.png'],
          ['텍스트cs-image://99999:https://storage.example.com/sig/b.png'],
        ],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{}], [{}]],
      }],
    })
    const html = renderSpreadsheetToHtml(doc)
    expect(html).toContain('width:20px')
    expect(html).toContain('width:1200px')
  })

  it('배경색 서식이 있는 셀에 오버레이가 추가되면 두 스타일이 하나의 style 속성으로 합쳐진다', () => {
    const doc = makeDoc({
      sheets: [{
        name: 'Sheet1',
        rows: [['텍스트cs-image://https://storage.example.com/sig/a.png']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{ backgroundColor: '#FFFF00' }]],
      }],
    })
    const html = renderSpreadsheetToHtml(doc)
    // <td>에는 style 속성이 하나로 병합돼야 함(배경색+position:relative가 별도 두 개의
    // style= 속성으로 쪼개지면 무효 HTML — 브라우저가 나중 것만 적용해 배경색이 사라짐).
    // <img>도 자체 style(width)을 갖지만 이는 <td>와 무관한 별도 요소이므로 <td> 태그
    // 자체만 추출해 검사한다.
    const tdMatch = html.match(/<td[^>]*>/)
    expect(tdMatch).not.toBeNull()
    const tdTag = tdMatch?.[0] ?? ''
    const styleAttrCountInTd = (tdTag.match(/style="/g) ?? []).length
    expect(styleAttrCountInTd).toBe(1)
    expect(tdTag).toContain('background-color:#FFFF00')
    expect(tdTag).toContain('position:relative')
  })

  it('일반 텍스트 셀은 이미지로 렌더링되지 않는다(회귀 방지)', () => {
    const doc = makeDoc({
      sheets: [{
        name: 'Sheet1',
        rows: [['그냥 텍스트']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{}]],
      }],
    })
    const html = renderSpreadsheetToHtml(doc)
    expect(html).toContain('<td>그냥 텍스트</td>')
    expect(html).not.toContain('<img')
  })

  it('javascript: 등 http(s)가 아닌 URL은 이미지로 렌더링하지 않고 원문을 이스케이프해 표시한다(XSS 방지)', () => {
    const doc = makeDoc({
      sheets: [{
        name: 'Sheet1',
        rows: [['텍스트cs-image://javascript:alert(1)']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{}]],
      }],
    })
    const html = renderSpreadsheetToHtml(doc)
    // 이미지 태그로 렌더링되지 않아야 함 — src="javascript:..."가 되는 인젝션 벡터 차단
    expect(html).not.toContain('<img')
    expect(html).not.toContain('src="javascript:')
    // 이미지로 그리지 못한 값은 원문(마커 포함) 그대로 이스케이프 후 텍스트로 노출
    expect(html).toContain('cs-image://javascript:alert(1)')
  })

  it('이미지 URL 자체에 포함된 특수문자도 HTML 이스케이프된다', () => {
    const doc = makeDoc({
      sheets: [{
        name: 'Sheet1',
        rows: [['텍스트cs-image://https://storage.example.com/sig/a.png?x="onerror="alert(1)']],
        merges: [],
        colWidths: [null],
        cellFormatting: [[{}]],
      }],
    })
    const html = renderSpreadsheetToHtml(doc)
    expect(html).not.toContain('onerror="alert(1)"')
    expect(html).toContain('&quot;')
  })

  it('이미지 오버레이 셀도 병합(rowspan/colspan)이 정상 적용된다', () => {
    const doc = makeDoc({
      sheets: [{
        name: 'Sheet1',
        rows: [
          ['텍스트cs-image://https://storage.example.com/sig/a.png', ''],
          ['', ''],
        ],
        merges: [{ s: { r: 0, c: 0 }, e: { r: 1, c: 1 } }],
        colWidths: [null, null],
        cellFormatting: [[{}, {}], [{}, {}]],
      }],
    })
    const html = renderSpreadsheetToHtml(doc)
    expect(html).toContain('rowspan="2"')
    expect(html).toContain('colspan="2"')
    expect(html).toContain('<img src="https://storage.example.com/sig/a.png"')
  })
})
