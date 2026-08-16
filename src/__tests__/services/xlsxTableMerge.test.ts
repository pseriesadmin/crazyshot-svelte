// @vitest-environment jsdom
// parseSheet()가 테두리색 추출(extractBorderColors)에 DOMParser를 사용하므로 jsdom 필요 —
// 순수 Node 환경에서는 DOMParser가 없어 해당 부분만 조용히 빈 결과로 스킵된다(안전장치는
// 정상 동작하나 실제 파싱 로직이 검증되지 않음 → jsdom으로 전환해 실제 동작을 검증).
/**
 * xlsxTableMerge.test.ts
 *
 * .xlsx 병합 셀(`!merges`)·컬럼너비(`!cols`)·서식(배경색·테두리색) → TipTap 표 노드
 * (colspan/rowspan/colwidth/backgroundColor/borderColor) 변환 검증.
 * rowsToTiptapTable()은 순수 함수라 직접 단위 테스트, parseSheet()는 SheetJS/JSZip으로
 * 합성 워크북을 만들어 좌표 변환(선택 범위 상대화)·서식 추출을 검증한다(docxImport.test.ts가
 * AST를 직접 모사하는 것과 동일한 "실제 파일 픽스처 불필요" 패턴).
 */

import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { parseSheet, rowsToTiptapTable, type SheetMergeRange } from '$lib/utils/docImport/xlsxImport'
import { fitColumnWidthsToTarget, A4_CONTENT_WIDTH_PX } from '$lib/utils/docImport/fitColumnWidths'

// ─────────────────────────────────────────────────────────────────────────────
// rowsToTiptapTable — 병합 없음(회귀)
// ─────────────────────────────────────────────────────────────────────────────

describe('rowsToTiptapTable — 병합 없음(회귀)', () => {
  it('2x2 표 — 모든 셀이 노드로 생성되고 rowspan/colspan 없음', () => {
    const result = rowsToTiptapTable([
      ['A', 'B'],
      ['C', 'D'],
    ])
    expect(result.content).toHaveLength(2)
    const firstRowCells = result.content?.[0]?.content ?? []
    expect(firstRowCells).toHaveLength(2)
    expect(firstRowCells[0]?.attrs?.['rowspan']).toBeUndefined()
    expect(firstRowCells[0]?.attrs?.['colspan']).toBeUndefined()
    expect(firstRowCells[0]?.type).toBe('tableHeader') // 첫 행 = 헤더
    expect(result.content?.[1]?.content?.[0]?.type).toBe('tableCell')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// rowsToTiptapTable — 세로 병합(rowspan)
// ─────────────────────────────────────────────────────────────────────────────

describe('rowsToTiptapTable — 세로 병합(rowspan)', () => {
  it('(0,0)~(1,0) 세로 병합 → 앵커 셀 rowspan=2, 덮인 셀 노드 미생성', () => {
    const merges: SheetMergeRange[] = [{ s: { r: 0, c: 0 }, e: { r: 1, c: 0 } }]
    const result = rowsToTiptapTable(
      [
        ['병합됨', 'B'],
        ['', 'D'],
      ],
      merges,
    )
    const row0Cells = result.content?.[0]?.content ?? []
    const row1Cells = result.content?.[1]?.content ?? []
    expect(row0Cells).toHaveLength(2)      // (0,0) 앵커 + (0,1)
    expect(row1Cells).toHaveLength(1)      // (1,0)은 스킵됨, (1,1)만 남음
    expect(row0Cells[0]?.attrs?.['rowspan']).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// rowsToTiptapTable — 가로 병합(colspan) + 복합 병합
// ─────────────────────────────────────────────────────────────────────────────

describe('rowsToTiptapTable — 가로 병합(colspan)', () => {
  it('(0,0)~(0,1) 가로 병합 → 앵커 셀 colspan=2', () => {
    const merges: SheetMergeRange[] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]
    const result = rowsToTiptapTable([['헤더병합', '']], merges)
    const row0Cells = result.content?.[0]?.content ?? []
    expect(row0Cells).toHaveLength(1)
    expect(row0Cells[0]?.attrs?.['colspan']).toBe(2)
  })

  it('가로+세로 복합 병합(2x2 블록) → 앵커 1개만 rowspan=2 colspan=2', () => {
    const merges: SheetMergeRange[] = [{ s: { r: 0, c: 0 }, e: { r: 1, c: 1 } }]
    const result = rowsToTiptapTable(
      [
        ['블록', '', 'C'],
        ['', '', 'F'],
      ],
      merges,
    )
    const row0Cells = result.content?.[0]?.content ?? []
    const row1Cells = result.content?.[1]?.content ?? []
    expect(row0Cells).toHaveLength(2) // 앵커 + C
    expect(row1Cells).toHaveLength(1) // F만
    expect(row0Cells[0]?.attrs?.['rowspan']).toBe(2)
    expect(row0Cells[0]?.attrs?.['colspan']).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// rowsToTiptapTable — colwidth 주입
// ─────────────────────────────────────────────────────────────────────────────

describe('rowsToTiptapTable — colwidth 주입', () => {
  it('colWidths가 있으면 각 셀에 colwidth 배열 부여', () => {
    const result = rowsToTiptapTable([['A', 'B']], [], [100, 200])
    const cells = result.content?.[0]?.content ?? []
    expect(cells[0]?.attrs?.['colwidth']).toEqual([100])
    expect(cells[1]?.attrs?.['colwidth']).toEqual([200])
  })

  it('colspan=2 셀은 두 컬럼 너비를 배열로 부여', () => {
    const merges: SheetMergeRange[] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]
    const result = rowsToTiptapTable([['병합', '']], merges, [100, 200])
    const cells = result.content?.[0]?.content ?? []
    expect(cells[0]?.attrs?.['colwidth']).toEqual([100, 200])
  })

  it('colWidths 미지정 시 colwidth 속성 없음', () => {
    const result = rowsToTiptapTable([['A']])
    const cells = result.content?.[0]?.content ?? []
    expect(cells[0]?.attrs?.['colwidth']).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// rowsToTiptapTable — 빈 데이터
// ─────────────────────────────────────────────────────────────────────────────

describe('rowsToTiptapTable — 빈 데이터', () => {
  it('빈 배열이면 에러 throw', () => {
    expect(() => rowsToTiptapTable([])).toThrow('변환할 데이터가 없습니다.')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// parseSheet — 병합 좌표를 선택 범위 기준 상대 좌표로 변환
// ─────────────────────────────────────────────────────────────────────────────

/** SheetJS 워크북을 실제 .xlsx 바이너리로 직렬화해 File 객체로 반환 */
function makeXlsxFile(
  aoa: string[][],
  merges: XLSX.Range[] = [],
  cols: XLSX.ColInfo[] = [],
): File {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  if (merges.length) ws['!merges'] = merges
  if (cols.length) ws['!cols'] = cols
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true }) as ArrayBuffer
  return new File([buf], 'test.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

describe('parseSheet — 병합 좌표 변환', () => {
  it('범위 미지정(시트 전체) — 병합 좌표가 그대로 유지됨', async () => {
    const file = makeXlsxFile(
      [
        ['헤더병합', ''],
        ['A', 'B'],
      ],
      [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }],
    )
    const data = await parseSheet(file, { sheetName: 'Sheet1' })
    expect(data.merges).toEqual([{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }])
  })

  it('선택 범위가 시트 중간부터 시작 — 병합 좌표가 범위 기준으로 오프셋 보정됨', async () => {
    // 시트: 0행은 무관 데이터, 1~2행에 실제 표(1행에 가로병합)
    const file = makeXlsxFile(
      [
        ['무관', '무관'],
        ['헤더병합', ''],
        ['A', 'B'],
      ],
      [{ s: { r: 1, c: 0 }, e: { r: 1, c: 1 } }],
    )
    const data = await parseSheet(file, { sheetName: 'Sheet1', range: 'A2:B3' })
    // 범위 시작이 2행(인덱스1)이므로 병합 r좌표가 1→0으로 보정돼야 함
    expect(data.merges).toEqual([{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }])
    expect(data.rows[0]).toEqual(['헤더병합', ''])
  })

  it('선택 범위를 벗어난 병합은 제외됨', async () => {
    const file = makeXlsxFile(
      [
        ['A', 'B'],
        ['범위밖1', '범위밖2'],
      ],
      [{ s: { r: 1, c: 0 }, e: { r: 1, c: 1 } }], // 2번째 행에만 있는 병합
    )
    const data = await parseSheet(file, { sheetName: 'Sheet1', range: 'A1:B1' }) // 1행만 선택
    expect(data.merges).toEqual([])
  })

  it('컬럼 너비(!cols)가 wpx 기준으로 반환됨', async () => {
    // SheetJS는 실제 .xlsx 저장 시 문자폭(wch) 단위로 직렬화하고 읽을 때 wpx를 재계산함
    // (wpx를 직접 지정해도 write/read 왕복 과정에서 보존되지 않음 — 실제 파일 동작과 동일)
    const file = makeXlsxFile(
      [['A', 'B']],
      [],
      [{ wch: 15 }, { wch: 30 }],
    )
    const data = await parseSheet(file, { sheetName: 'Sheet1' })
    // 정확한 px는 폰트 메트릭에 따라 달라지므로 "두 번째 컬럼이 첫 번째보다 넓다"만 검증
    expect(data.colWidths[0]).toBeGreaterThan(0)
    expect(data.colWidths[1]).toBeGreaterThan(data.colWidths[0] ?? 0)
  })

  it('!cols에 없는(기본폭) 컬럼은 null이 아니라 알려진 폭의 평균으로 채워진다(2026-08-15 실사용 중 발견 — 34열 실제 계약서 표에서 재현)', async () => {
    // 실무 표는 사용자가 손댄 몇 개 컬럼만 !cols에 기록되고 나머지는 항목 자체가 없다.
    // 34열 중 2개만 wch를 지정 — 나머지 32개는 시트 자체에 폭 정보가 아예 없는 상태를 재현.
    const colCount = 34
    const aoa = [Array.from({ length: colCount }, (_, i) => `C${i}`)]
    const cols: XLSX.ColInfo[] = Array.from({ length: colCount }, (_, i) =>
      i === 0 || i === 1 ? { wch: 12 } : {},
    )
    const file = makeXlsxFile(aoa, [], cols)
    const data = await parseSheet(file, { sheetName: 'Sheet1' })

    expect(data.colWidths).toHaveLength(colCount)
    // null이 하나도 없어야 함 — fitColumnWidthsToTarget이 전체 컬럼 수를 인식할 수 있어야 함
    expect(data.colWidths.every((w) => typeof w === 'number' && w > 0)).toBe(true)

    // 이 폭들을 실제로 축소하면 "TipTap 자체 기본폭(약 25px)이 그대로 적용되며 34 × 25px ≈
    // 850px로 A4 폭을 넘기던" 과거 버그보다 훨씬 좁아져야 한다. 34열 × 20px(컬럼당 최소폭
    // 하한) = 680px가 이 케이스의 이론적 하한(컬럼 수가 너무 많아 목표 폭 642px보다 하한이
    // 먼저 걸림 — "축소는 하되 완전히 안 보일 정도로 짓누르진 않는다"는 의도된 동작이지
    // 버그 아님). 이 하한보다 넓으면 안 됨.
    const fitted = fitColumnWidthsToTarget(data.colWidths)
    const total = fitted.reduce((a: number, b) => a + (b ?? 0), 0)
    const MIN_COLUMN_WIDTH_PX = 20
    expect(total).toBeLessThanOrEqual(colCount * MIN_COLUMN_WIDTH_PX)
    // 과거 버그 재현 방지 회귀: TipTap 기본폭(25px) 적용 시의 850px보다는 명확히 좁아야 함
    expect(total).toBeLessThan(colCount * 25)
  })

  it('존재하지 않는 시트명이면 에러 throw', async () => {
    const file = makeXlsxFile([['A']])
    await expect(parseSheet(file, { sheetName: '없는시트' })).rejects.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// parseSheet — 서식 적용된 숫자/날짜 셀(raw:false, 2026-08-15 실사용 중 발견한 회귀)
//
// raw:true(SheetJS 기본값)는 셀 서식이 적용되기 전 원시값을 반환해 통화·날짜처럼 서식이
// 입혀진 셀이 "1200000"(₩1,200,000 대신)이나 날짜 일련번호로 깨져 나온다.
// ─────────────────────────────────────────────────────────────────────────────

describe('parseSheet — 서식 적용된 값 반환(raw:false)', () => {
  it('통화 서식(#,##0"원") 숫자 셀 — 원시값이 아닌 서식 적용된 텍스트로 반환', async () => {
    const ws: XLSX.WorkSheet = {}
    ws['A1'] = { t: 'n', v: 1200000, z: '#,##0"원"' }
    ws['!ref'] = 'A1:A1'
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const file = new File([buf], 'test.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const data = await parseSheet(file, { sheetName: 'Sheet1' })
    expect(data.rows[0]?.[0]).not.toBe('1200000') // 원시값 그대로면 실패해야 함
    expect(data.rows[0]?.[0]).toContain('1,200,000')
    expect(data.rows[0]?.[0]).toContain('원')
  })

  it('날짜 서식 숫자 셀 — 일련번호가 아닌 날짜 텍스트로 반환', async () => {
    const ws: XLSX.WorkSheet = {}
    ws['A1'] = { t: 'n', v: 45888, z: 'yyyy-mm-dd' } // 2025-08-19에 해당하는 일련번호
    ws['!ref'] = 'A1:A1'
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const file = new File([buf], 'test.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const data = await parseSheet(file, { sheetName: 'Sheet1' })
    expect(data.rows[0]?.[0]).not.toBe('45888')
    expect(data.rows[0]?.[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// parseSheet — 시각적 여백용 빈 행이 있는 실무 문서(2026-08-14 실사용 중 발견한 회귀)
//
// 실제 계약서 등 실무 스프레드시트는 셀을 전혀 건드리지 않은(=완전 sparse, 값을 채운 셀
// 객체 자체가 없는) 빈 행이 흔하다. aoa_to_sheet()는 빈 문자열도 실제 셀 객체로 써버려
// 이 상황을 재현하지 못하므로, 아래 헬퍼로 특정 행의 셀 객체를 직접 제거해 재현한다.
// ─────────────────────────────────────────────────────────────────────────────

/** aoa_to_sheet로 만든 워크시트에서 특정 행의 모든 셀 객체를 제거해 "완전 sparse 빈 행"으로 만든다 */
function makeSparseBlankRow(ws: XLSX.WorkSheet, rowIndex: number, colCount: number): void {
  for (let c = 0; c < colCount; c++) {
    delete ws[XLSX.utils.encode_cell({ r: rowIndex, c })]
  }
}

describe('parseSheet — 병합에 걸치지 않은 완전 빈 행(sparse) 처리', () => {
  it('병합과 무관한 완전 빈 행은 제거되고, 이후 병합 좌표가 올바르게 재인덱싱됨', async () => {
    // 0행: 헤더, 1행: 완전 빈 여백 행(sparse), 2~3행: 세로병합
    const ws = XLSX.utils.aoa_to_sheet([
      ['헤더A', '헤더B'],
      ['', ''],
      ['병합됨', 'X'],
      ['', 'Y'],
    ])
    makeSparseBlankRow(ws, 1, 2)
    ws['!merges'] = [{ s: { r: 2, c: 0 }, e: { r: 3, c: 0 } }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const file = new File([buf], 'test.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const data = await parseSheet(file, { sheetName: 'Sheet1' })

    // 빈 여백 행(원본 1행)이 제거돼 3행만 남아야 함
    expect(data.rows).toHaveLength(3)
    expect(data.rows[0]).toEqual(['헤더A', '헤더B'])
    expect(data.rows[1]).toEqual(['병합됨', 'X'])
    expect(data.rows[2]).toEqual(['', 'Y'])

    // 병합 좌표는 원본(2,3행) → 제거 후 최종 배열 기준(1,2행)으로 재인덱싱돼야 함
    expect(data.merges).toEqual([{ s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }])

    // 재인덱싱된 병합으로 실제 표를 만들면 병합이 정확히 반영돼야 함
    const table = rowsToTiptapTable(data.rows, data.merges, data.colWidths)
    const row1Cells = table.content?.[1]?.content ?? []
    expect(row1Cells).toHaveLength(2) // 앵커(병합됨, rowspan=2) + X
    expect(row1Cells[0]?.attrs?.['rowspan']).toBe(2)
    const row2Cells = table.content?.[2]?.content ?? []
    expect(row2Cells).toHaveLength(1) // 앵커에 흡수된 첫 컬럼 제외, Y만 남음
  })

  it('병합이 걸쳐있는 빈 행(텍스트는 비었지만 세로병합의 연속 셀)은 제거되지 않음', async () => {
    // 0행: 헤더, 1~2행: 세로병합(1행에만 텍스트, 2행은 병합에 흡수돼 시각적으로 완전 빈 행처럼 보임)
    const ws = XLSX.utils.aoa_to_sheet([
      ['헤더A', '헤더B'],
      ['병합됨', 'X'],
      ['', 'Y'], // 셀(2,0)은 병합 연속 셀 — 문자열은 비었지만 sparse는 아님(merge 앵커 있음)
    ])
    ws['!merges'] = [{ s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const file = new File([buf], 'test.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const data = await parseSheet(file, { sheetName: 'Sheet1' })

    // 3행 전부 유지돼야 함(2행이 텍스트상 비었어도 열 B에 'Y' 값이 있어 애초에 sparse 빈 행이 아님)
    expect(data.rows).toHaveLength(3)
    expect(data.merges).toEqual([{ s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// rowsToTiptapTable — 세로병합에 완전히 흡수된 행은 <tr> 자체를 생성하지 않음
// ─────────────────────────────────────────────────────────────────────────────

describe('rowsToTiptapTable — 완전히 흡수된 행 스킵', () => {
  it('한 행의 유일한 컬럼이 세로병합에 흡수되면 그 행은 tableRow를 생성하지 않음', () => {
    const merges: SheetMergeRange[] = [{ s: { r: 0, c: 0 }, e: { r: 1, c: 0 } }]
    const result = rowsToTiptapTable(
      [
        ['병합됨'],
        [''], // 유일한 컬럼이 병합에 흡수됨 → 이 행 전체가 빈 행이 됨
      ],
      merges,
    )
    // 2번째 행(<tr>)이 아예 생성되지 않아야 함
    expect(result.content).toHaveLength(1)
    expect(result.content?.[0]?.content?.[0]?.attrs?.['rowspan']).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// rowsToTiptapTable — 셀 서식(배경색·테두리색) 반영
// ─────────────────────────────────────────────────────────────────────────────

describe('rowsToTiptapTable — cellFormatting(배경색·테두리색) 반영', () => {
  it('cellFormatting이 있으면 해당 셀 attrs에 backgroundColor/borderColor가 부여됨', () => {
    const result = rowsToTiptapTable(
      [['A', 'B']],
      [],
      [],
      [[{ backgroundColor: '#FF0000', borderColor: '#0000FF' }, {}]],
    )
    const cells = result.content?.[0]?.content ?? []
    expect(cells[0]?.attrs?.['backgroundColor']).toBe('#FF0000')
    expect(cells[0]?.attrs?.['borderColor']).toBe('#0000FF')
    expect(cells[1]?.attrs?.['backgroundColor']).toBeUndefined()
  })

  it('cellFormatting 미지정 시 backgroundColor/borderColor attrs 없음(회귀)', () => {
    const result = rowsToTiptapTable([['A']])
    const cells = result.content?.[0]?.content ?? []
    expect(cells[0]?.attrs?.['backgroundColor']).toBeUndefined()
    expect(cells[0]?.attrs?.['borderColor']).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// parseSheet — 셀 서식(배경색·테두리색) 추출 (2026-08-15 실사용 중 요청으로 추가)
//
// 배경색은 xlsx 패키지가 cellStyles:true로 이미 노출하는 ws[addr].s.fgColor.rgb를 그대로
// 사용한다(SheetJS write/read 왕복으로 검증 가능). 테두리색은 xlsx 패키지 공개 API가 전혀
// 제공하지 않아(소스 직접 확인) OOXML을 직접 구성해 raw XML 파싱 경로를 검증해야 한다 —
// SheetJS의 고수준 writer는 임의의 cell.s 객체를 실제 styles.xml로 직렬화해주지 않으므로
// (write 왕복 테스트로 직접 확인된 한계), jszip으로 최소 xlsx 패키지를 수동 구성한다.
// ─────────────────────────────────────────────────────────────────────────────

/** 배경색·테두리색이 적용된 최소 .xlsx 패키지를 수동 구성해 File로 반환 (jszip 직접 조립) */
async function makeStyledXlsxFile(): Promise<File> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>',
  )
  zip.file(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>' +
      '</workbook>',
  )
  // fill 1(인덱스1) = 빨강 배경, border 1(인덱스1) = 파랑 테두리. cellXfs[1]이 A1에 적용(s="1"),
  // cellXfs[0](서식 없음)이 B1에 적용(s="0" 또는 생략)
  zip.file(
    'xl/styles.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFFF0000"/><bgColor indexed="64"/></patternFill></fill>' +
      '</fills>' +
      '<borders count="2">' +
      '<border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left style="thin"><color rgb="FF0000FF"/></left><right/><top style="thin"><color rgb="FF0000FF"/></top><bottom/><diagonal/></border>' +
      '</borders>' +
      '<cellXfs count="2">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>' +
      '<xf numFmtId="0" fontId="0" fillId="1" borderId="1" applyFill="1" applyBorder="1"/>' +
      '</cellXfs>' +
      '</styleSheet>',
  )
  zip.file(
    'xl/worksheets/sheet1.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData>' +
      '<row r="1">' +
      '<c r="A1" s="1" t="inlineStr"><is><t>서식있음</t></is></c>' +
      '<c r="B1" t="inlineStr"><is><t>서식없음</t></is></c>' +
      '</row>' +
      '</sheetData>' +
      '</worksheet>',
  )
  const buf = await zip.generateAsync({ type: 'arraybuffer' })
  return new File([buf], 'styled.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

describe('parseSheet — 셀 서식(배경색·테두리색) 추출', () => {
  it('배경색·테두리색이 적용된 셀은 cellFormatting에 정확히 반영되고, 서식 없는 셀은 빈 객체', async () => {
    const file = await makeStyledXlsxFile()
    const data = await parseSheet(file, { sheetName: 'Sheet1' })

    expect(data.rows[0]).toEqual(['서식있음', '서식없음'])
    expect(data.cellFormatting[0]?.[0]?.backgroundColor).toBe('#FF0000')
    expect(data.cellFormatting[0]?.[0]?.borderColor).toBe('#0000FF')
    expect(data.cellFormatting[0]?.[1]?.backgroundColor).toBeUndefined()
    expect(data.cellFormatting[0]?.[1]?.borderColor).toBeUndefined()
  })

  it('추출된 서식을 rowsToTiptapTable에 그대로 넘기면 실제 표 노드에 반영됨', async () => {
    const file = await makeStyledXlsxFile()
    const data = await parseSheet(file, { sheetName: 'Sheet1' })
    const table = rowsToTiptapTable(data.rows, data.merges, data.colWidths, data.cellFormatting)
    const cells = table.content?.[0]?.content ?? []
    expect(cells[0]?.attrs?.['backgroundColor']).toBe('#FF0000')
    expect(cells[0]?.attrs?.['borderColor']).toBe('#0000FF')
  })

  it('styles.xml이 없는(구조가 다른) 파일은 에러 없이 빈 서식으로 처리됨(안전장치)', async () => {
    // 병합 테스트용 makeXlsxFile()은 SheetJS 고수준 writer라 실제로는 styles.xml을 만들지만
    // fills/cellXfs에 우리가 기대하는 커스텀 서식이 없음 — 이 경우도 크래시 없이 빈 값 반환돼야 함
    const file = makeXlsxFile([['A', 'B']])
    const data = await parseSheet(file, { sheetName: 'Sheet1' })
    expect(data.cellFormatting[0]?.[0] ?? {}).toEqual({})
  })
})
