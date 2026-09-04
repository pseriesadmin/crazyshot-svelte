/**
 * spreadsheetRepeatRegion.test.ts
 * Stage 2 TDD — SpreadsheetSheet.repeatRegion + substituteSpreadsheetDocument() 반복행 확장
 *
 * Harness Flow v3.2 | RED → GREEN → REFACTOR
 *
 * 검증 항목:
 *  A. 무회귀 (repeatRegion 없음)
 *    A-1: 기존 스칼라 치환이 변경 없이 동작 (repeatRegion 없는 기존 템플릿)
 *    A-2: 상품목록 배열 필드가 있어도 repeatRegion 없으면 기존 행 수 그대로
 *
 *  B. 항목수 = 템플릿행수 (1:1 매핑)
 *    B-1: 3개 항목 × 3행 템플릿 → 전체 행 수 = before + N + after
 *    B-2: 각 행이 해당 항목의 값으로 치환됨 (인덱스별 값 매핑)
 *    B-3: 반복 영역 이전·이후 행은 스칼라 치환으로 정상 처리
 *    B-4: 반복 영역 안 변수(상품명)가 항목별로 서로 다른 값으로 확장됨
 *    B-5: 반복 영역 안 스칼라 폴백 — 항목 필드가 없는 변수(고객이름)는 스칼라로 치환
 *
 *  C. 항목수 > 템플릿행수 (Q3 분기 — 자동 행 추가)
 *    C-1: 2개 항목 × 1행 템플릿 → 2행 출력
 *    C-2: 4개 항목 × 2행 템플릿 → 4행 출력 (마지막 템플릿행 서식 복제)
 *    C-3: 자동 추가된 행 값이 해당 항목 데이터로 치환됨
 *    C-4: 자동 추가된 행의 cellFormatting이 마지막 템플릿행과 동일
 *
 *  D. 병합(merges) 처리
 *    D-1: 반복 영역 앞 병합은 유지됨
 *    D-2: 반복 영역 뒤 병합은 행 인덱스가 rowDelta(N-T)만큼 보정됨
 *    D-3: 반복 영역 안 컬럼 span 병합이 각 항목 행에 복제됨
 *
 *  E. 엣지케이스
 *    E-1: 상품목록이 빈 배열 + repeatRegion 있음 → 템플릿 행 수 유지, 전부 공백 처리
 *    E-2: 상품목록이 undefined + repeatRegion 있음 → 기존 스칼라 치환 동작 유지
 *    E-3: 항목수 < 템플릿행수 → 템플릿 행 수 유지, 앞쪽 N행만 채우고 나머지는 공백
 *         (2026-09-03 Stephen 확정 — 잉여 템플릿행을 없애지 않고 공백으로 유지하도록 변경)
 *
 *  F. 잉여 슬롯 공백 처리 (2026-09-03 신규)
 *    F-1: N < T — 잉여 행의 변수가 {{}} 원문도, 이전 항목 값도 아닌 빈 문자열로 치환됨
 *    F-2: N < T — 잉여 행을 포함한 전체 행 수가 항상 T로 고정됨(항목 수와 무관)
 *    F-3: N < T — merges가 원본과 완전히 동일(행 위치가 전혀 바뀌지 않으므로 재계산 없음)
 */

import { describe, it, expect } from 'vitest'
import { substituteSpreadsheetDocument } from '$lib/utils/contract-substitution'
import type { SpreadsheetDocument, SpreadsheetSheet } from '$lib/types/contract-document'
import type { ContractSubstitutionData } from '$lib/types/contract-module'

// ─────────────────────────────────────────────────────────────────────────────
// 픽스처 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/** 기본 시트 생성 헬퍼 */
function makeSheet(overrides: Partial<SpreadsheetSheet>): SpreadsheetSheet {
  return {
    name: 'Sheet1',
    rows: [],
    merges: [],
    colWidths: [],
    cellFormatting: [],
    ...overrides,
  }
}

function makeDoc(sheet: SpreadsheetSheet): SpreadsheetDocument {
  return { sheets: [sheet], activeSheetIndex: 0 }
}

// ─────────────────────────────────────────────────────────────────────────────
// A. 무회귀 — repeatRegion 없는 기존 템플릿
// ─────────────────────────────────────────────────────────────────────────────

describe('A. 무회귀 — repeatRegion 없음', () => {
  it('A-1: 기존 스칼라 변수가 정상 치환됨', () => {
    const doc = makeDoc(makeSheet({
      rows: [['{{고객이름}}', '{{상품명}}'], ['{{기본대여요금}}', '']],
      cellFormatting: [[{}, {}], [{}, {}]],
    }))
    const data: ContractSubstitutionData = {
      고객이름: '홍길동',
      상품명: '카메라 A',
      기본대여요금: '100,000원',
    }
    const result = substituteSpreadsheetDocument(doc, data)
    const rows = result.sheets[0].rows
    expect(rows.length).toBe(2)
    expect(rows[0][0]).toBe('홍길동')
    expect(rows[0][1]).toBe('카메라 A')
    expect(rows[1][0]).toBe('100,000원')
  })

  it('A-2: 상품목록 배열이 있어도 repeatRegion 없으면 행 수 동일하고 스칼라만 치환', () => {
    const doc = makeDoc(makeSheet({
      rows: [['{{상품명}}', '{{수량}}']],
      cellFormatting: [[{}, {}]],
    }))
    const data: ContractSubstitutionData = {
      상품명: '카메라 A',
      수량: '1',
      상품목록: [
        { 상품명: '카메라 B', 수량: '2', 금액: '200,000원' },
        { 상품명: '렌즈 C', 수량: '1', 금액: '100,000원' },
      ],
    }
    const result = substituteSpreadsheetDocument(doc, data)
    const rows = result.sheets[0].rows
    // 행 수는 그대로 1행
    expect(rows.length).toBe(1)
    // 스칼라 값(상품명=카메라 A, 수량=1)으로만 치환
    expect(rows[0][0]).toBe('카메라 A')
    expect(rows[0][1]).toBe('1')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// B. 항목수 = 템플릿행수 (1:1 매핑)
// ─────────────────────────────────────────────────────────────────────────────

describe('B. 항목수 = 템플릿행수', () => {
  /** 3행 템플릿 + before/after 구성 픽스처 */
  const sheet3items = makeSheet({
    rows: [
      ['헤더1', '헤더2', '헤더3'],       // row 0: before region
      ['{{상품명}}', '{{수량}}', '{{금액}}'],  // row 1: repeat start
      ['{{상품명}}', '{{수량}}', '{{금액}}'],  // row 2
      ['{{상품명}}', '{{수량}}', '{{금액}}'],  // row 3: repeat end
      ['합계', '', '{{최종합계}}'],         // row 4: after region
    ],
    cellFormatting: [
      [{}, {}, {}],
      [{ backgroundColor: '#EEEEEE' }, {}, {}],
      [{ backgroundColor: '#EEEEEE' }, {}, {}],
      [{ backgroundColor: '#EEEEEE' }, {}, {}],
      [{}, {}, {}],
    ],
    repeatRegion: { startRow: 1, endRow: 3 },
  })

  const data3items: ContractSubstitutionData = {
    최종합계: '300,000원',
    상품목록: [
      { 상품명: '카메라 A', 수량: '1', 금액: '100,000원' },
      { 상품명: '렌즈 B', 수량: '2', 금액: '150,000원' },
      { 상품명: '삼각대', 수량: '1', 금액: '50,000원' },
    ],
  }

  it('B-1: 전체 행 수 = before(1) + 항목 수(3) + after(1) = 5', () => {
    const result = substituteSpreadsheetDocument(makeDoc(sheet3items), data3items)
    expect(result.sheets[0].rows.length).toBe(5)
  })

  it('B-2: 각 반복 행이 대응하는 항목 값으로 치환됨', () => {
    const result = substituteSpreadsheetDocument(makeDoc(sheet3items), data3items)
    const rows = result.sheets[0].rows
    // row 1: item[0]
    expect(rows[1][0]).toBe('카메라 A')
    expect(rows[1][1]).toBe('1')
    expect(rows[1][2]).toBe('100,000원')
    // row 2: item[1]
    expect(rows[2][0]).toBe('렌즈 B')
    expect(rows[2][1]).toBe('2')
    expect(rows[2][2]).toBe('150,000원')
    // row 3: item[2]
    expect(rows[3][0]).toBe('삼각대')
    expect(rows[3][1]).toBe('1')
    expect(rows[3][2]).toBe('50,000원')
  })

  it('B-3: before 행(row 0)과 after 행(row 4)은 스칼라 치환만 적용', () => {
    const result = substituteSpreadsheetDocument(makeDoc(sheet3items), data3items)
    const rows = result.sheets[0].rows
    expect(rows[0][0]).toBe('헤더1')   // before — 변수 없음
    expect(rows[4][2]).toBe('300,000원') // after — 스칼라 치환
  })

  it('B-4: 항목별로 서로 다른 상품명이 각 행에 출력됨', () => {
    const result = substituteSpreadsheetDocument(makeDoc(sheet3items), data3items)
    const rows = result.sheets[0].rows
    const 상품명들 = [rows[1][0], rows[2][0], rows[3][0]]
    expect(상품명들).toEqual(['카메라 A', '렌즈 B', '삼각대'])
  })

  it('B-5: 반복 영역 안에서 항목 필드에 없는 변수(고객이름)는 스칼라로 폴백 치환', () => {
    const sheet = makeSheet({
      rows: [
        ['{{상품명}}', '{{고객이름}}'],  // repeat 영역에 고객이름도 포함
      ],
      cellFormatting: [[{}, {}]],
      repeatRegion: { startRow: 0, endRow: 0 },
    })
    const data: ContractSubstitutionData = {
      고객이름: '홍길동',
      상품목록: [
        { 상품명: '카메라 A', 수량: '1', 금액: '100,000원' },
      ],
    }
    const result = substituteSpreadsheetDocument(makeDoc(sheet), data)
    const rows = result.sheets[0].rows
    expect(rows[0][0]).toBe('카메라 A') // 항목 값
    expect(rows[0][1]).toBe('홍길동')  // 스칼라 폴백
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// C. 항목수 > 템플릿행수 (Q3 분기 — 자동 행 추가)
// ─────────────────────────────────────────────────────────────────────────────

describe('C. 항목수 > 템플릿행수 (자동 행 추가)', () => {
  it('C-1: 2개 항목 × 1행 템플릿 → 2행 출력', () => {
    const sheet = makeSheet({
      rows: [['{{상품명}}', '{{수량}}']],  // 1행 템플릿
      cellFormatting: [[{}, {}]],
      repeatRegion: { startRow: 0, endRow: 0 },
    })
    const data: ContractSubstitutionData = {
      상품목록: [
        { 상품명: '카메라 A', 수량: '1', 금액: '100,000원' },
        { 상품명: '렌즈 B', 수량: '2', 금액: '150,000원' },
      ],
    }
    const result = substituteSpreadsheetDocument(makeDoc(sheet), data)
    expect(result.sheets[0].rows.length).toBe(2)
    expect(result.sheets[0].rows[0][0]).toBe('카메라 A')
    expect(result.sheets[0].rows[1][0]).toBe('렌즈 B')
  })

  it('C-2: 4개 항목 × 2행 템플릿 → 4행 출력 (마지막 템플릿행 서식 복제)', () => {
    const sheet = makeSheet({
      rows: [
        ['{{상품명}}', ''],  // template row 0
        ['', '{{금액}}'],   // template row 1 (마지막)
      ],
      cellFormatting: [
        [{ backgroundColor: '#CCCCCC' }, {}],  // template row 0 서식
        [{ backgroundColor: '#FFFFFF' }, {}],  // template row 1 서식
      ],
      repeatRegion: { startRow: 0, endRow: 1 },
    })
    const data: ContractSubstitutionData = {
      상품목록: [
        { 상품명: '카메라 A', 수량: '1', 금액: '100,000원' },
        { 상품명: '렌즈 B', 수량: '2', 금액: '150,000원' },
        { 상품명: '삼각대', 수량: '1', 금액: '50,000원' },
        { 상품명: '가방', 수량: '1', 금액: '30,000원' },
      ],
    }
    const result = substituteSpreadsheetDocument(makeDoc(sheet), data)
    expect(result.sheets[0].rows.length).toBe(4)
  })

  it('C-3: 자동 추가된 행(템플릿 초과 항목)의 값이 해당 항목 데이터로 치환됨', () => {
    const sheet = makeSheet({
      rows: [['{{상품명}}', '{{금액}}']],  // 1행 템플릿
      cellFormatting: [[{}, {}]],
      repeatRegion: { startRow: 0, endRow: 0 },
    })
    const data: ContractSubstitutionData = {
      상품목록: [
        { 상품명: '카메라 A', 수량: '1', 금액: '100,000원' },
        { 상품명: '렌즈 B', 수량: '2', 금액: '150,000원' },
        { 상품명: '삼각대', 수량: '1', 금액: '50,000원' },
      ],
    }
    const result = substituteSpreadsheetDocument(makeDoc(sheet), data)
    const rows = result.sheets[0].rows
    expect(rows.length).toBe(3)
    // 3번째 항목(템플릿 초과)도 정확히 치환됨
    expect(rows[2][0]).toBe('삼각대')
    expect(rows[2][1]).toBe('50,000원')
  })

  it('C-4: 자동 추가된 행의 cellFormatting이 마지막 템플릿행과 동일', () => {
    const lastRowFmt = [{ backgroundColor: '#F0F0F0' }, { backgroundColor: '#FFFFFF' }]
    const sheet = makeSheet({
      rows: [
        ['template-row-0', ''],
        ['template-row-1', ''],  // 마지막 템플릿행
      ],
      cellFormatting: [
        [{}, {}],
        lastRowFmt,
      ],
      repeatRegion: { startRow: 0, endRow: 1 },
    })
    const data: ContractSubstitutionData = {
      상품목록: [
        { 상품명: '항목1', 수량: '1', 금액: '1,000원' },
        { 상품명: '항목2', 수량: '1', 금액: '2,000원' },
        { 상품명: '항목3', 수량: '1', 금액: '3,000원' },  // 템플릿 초과
      ],
    }
    const result = substituteSpreadsheetDocument(makeDoc(sheet), data)
    const fmt = result.sheets[0].cellFormatting
    // row 2 (item index 2, 템플릿 초과 → 마지막 템플릿행 서식 복제)
    expect(fmt[2]).toEqual(lastRowFmt)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// D. 병합(merges) 처리
// ─────────────────────────────────────────────────────────────────────────────

describe('D. merges 처리', () => {
  it('D-1: 반복 영역 앞 병합은 유지됨', () => {
    const sheet = makeSheet({
      rows: [
        ['병합됨', '', ''],       // row 0: before region (colspan 2)
        ['{{상품명}}', '', ''],   // row 1: repeat region
      ],
      merges: [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } },  // row 0 colspan 2 (before)
      ],
      cellFormatting: [[{}, {}, {}], [{}, {}, {}]],
      repeatRegion: { startRow: 1, endRow: 1 },
    })
    const data: ContractSubstitutionData = {
      상품목록: [
        { 상품명: '카메라', 수량: '1', 금액: '100,000원' },
        { 상품명: '렌즈', 수량: '1', 금액: '50,000원' },
      ],
    }
    const result = substituteSpreadsheetDocument(makeDoc(sheet), data)
    const merges = result.sheets[0].merges
    // before 병합은 row 0 그대로 유지돼야 함
    const beforeMerge = merges.find(m => m.s.r === 0 && m.e.r === 0)
    expect(beforeMerge).toBeDefined()
    expect(beforeMerge?.s.c).toBe(0)
    expect(beforeMerge?.e.c).toBe(1)
  })

  it('D-2: 반복 영역 뒤 병합은 rowDelta(N-T)만큼 보정됨', () => {
    // template: 1행, items: 3개 → rowDelta = 3 - 1 = 2
    const sheet = makeSheet({
      rows: [
        ['{{상품명}}'],              // row 0: repeat region (T=1)
        ['after-1', ''],             // row 1: after region
        ['합계병합', ''],            // row 2: after region (colspan)
      ],
      merges: [
        { s: { r: 2, c: 0 }, e: { r: 2, c: 1 } },  // row 2 colspan (after)
      ],
      cellFormatting: [[{}], [{}, {}], [{}, {}]],
      repeatRegion: { startRow: 0, endRow: 0 },
    })
    const data: ContractSubstitutionData = {
      상품목록: [
        { 상품명: '항목A', 수량: '1', 금액: '1,000원' },
        { 상품명: '항목B', 수량: '1', 금액: '2,000원' },
        { 상품명: '항목C', 수량: '1', 금액: '3,000원' },
      ],
    }
    const result = substituteSpreadsheetDocument(makeDoc(sheet), data)
    // 전체 행: 3(items) + 2(after) = 5행
    expect(result.sheets[0].rows.length).toBe(5)
    // after 병합: 원래 row 2 → rowDelta=2 이동 → row 4
    const merges = result.sheets[0].merges
    const afterMerge = merges.find(m => m.s.c === 0 && m.e.c === 1)
    expect(afterMerge).toBeDefined()
    expect(afterMerge?.s.r).toBe(4)  // 2 + 2(rowDelta) = 4
    expect(afterMerge?.e.r).toBe(4)
  })

  it('D-3: 반복 영역 안 열 병합(colspan)이 각 항목 행에 복제됨', () => {
    // template 1행, col 0-1이 병합됨, 3개 항목
    const sheet = makeSheet({
      rows: [['{{상품명}}', '', '{{금액}}']],  // row 0: repeat (col 0-1 병합)
      merges: [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } },  // row 0 colspan (inside repeat)
      ],
      cellFormatting: [[{}, {}, {}]],
      repeatRegion: { startRow: 0, endRow: 0 },
    })
    const data: ContractSubstitutionData = {
      상품목록: [
        { 상품명: '항목A', 수량: '1', 금액: '1,000원' },
        { 상품명: '항목B', 수량: '1', 금액: '2,000원' },
        { 상품명: '항목C', 수량: '1', 금액: '3,000원' },
      ],
    }
    const result = substituteSpreadsheetDocument(makeDoc(sheet), data)
    const merges = result.sheets[0].merges
    // 3개 항목 → 각 행에 colspan 병합이 복제되어야 함 (총 3개 병합)
    const inRegionMerges = merges.filter(m => m.s.c === 0 && m.e.c === 1)
    expect(inRegionMerges.length).toBe(3)
    // row 0: item 0
    expect(inRegionMerges[0].s.r).toBe(0)
    // row 1: item 1
    expect(inRegionMerges[1].s.r).toBe(1)
    // row 2: item 2
    expect(inRegionMerges[2].s.r).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// E. 엣지케이스
// ─────────────────────────────────────────────────────────────────────────────

describe('E. 엣지케이스', () => {
  it('E-1: 상품목록이 빈 배열 + repeatRegion 있음 → 템플릿 행 수 유지, 변수는 공백 처리', () => {
    const sheet = makeSheet({
      rows: [
        ['헤더'],                  // row 0: before
        ['{{상품명}}'],            // row 1: repeat
        ['합계'],                  // row 2: after
      ],
      cellFormatting: [[{}], [{}], [{}]],
      repeatRegion: { startRow: 1, endRow: 1 },
    })
    const data: ContractSubstitutionData = { 상품목록: [] }
    const result = substituteSpreadsheetDocument(makeDoc(sheet), data)
    // before(1) + repeat(1, 공백 유지) + after(1) = 3행 — 행 자체는 사라지지 않음
    expect(result.sheets[0].rows.length).toBe(3)
    expect(result.sheets[0].rows[0][0]).toBe('헤더')
    expect(result.sheets[0].rows[1][0]).toBe('') // {{상품명}} → 공백(원문 노출도, 이전 값도 아님)
    expect(result.sheets[0].rows[2][0]).toBe('합계')
  })

  it('E-2: 상품목록이 undefined + repeatRegion 있음 → 기존 스칼라 치환 동작 유지', () => {
    const sheet = makeSheet({
      rows: [['{{상품명}}', '{{고객이름}}']],
      cellFormatting: [[{}, {}]],
      repeatRegion: { startRow: 0, endRow: 0 },
    })
    const data: ContractSubstitutionData = {
      상품명: '카메라 A',
      고객이름: '홍길동',
      // 상품목록 undefined
    }
    const result = substituteSpreadsheetDocument(makeDoc(sheet), data)
    // 기존처럼 1행으로 스칼라 치환
    expect(result.sheets[0].rows.length).toBe(1)
    expect(result.sheets[0].rows[0][0]).toBe('카메라 A')
    expect(result.sheets[0].rows[0][1]).toBe('홍길동')
  })

  it('E-3: 항목수(2) < 템플릿행수(4) → 템플릿 행 수(4) 그대로 유지, 앞 2행만 채움', () => {
    const sheet = makeSheet({
      rows: [
        ['template row 0'],
        ['template row 1'],
        ['template row 2'],
        ['template row 3'],
      ],
      cellFormatting: [[{}], [{}], [{}], [{}]],
      repeatRegion: { startRow: 0, endRow: 3 },
    })
    const data: ContractSubstitutionData = {
      상품목록: [
        { 상품명: '항목A', 수량: '1', 금액: '1,000원' },
        { 상품명: '항목B', 수량: '1', 금액: '2,000원' },
      ],
    }
    const result = substituteSpreadsheetDocument(makeDoc(sheet), data)
    // 항목이 2개여도 템플릿 4행 전부 유지(잉여 2행은 뒤에서 공백 처리)
    expect(result.sheets[0].rows.length).toBe(4)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// F. 잉여 슬롯 공백 처리 (2026-09-03 신규 — Stephen 확정: "항목 수만큼만 반영하고
// 나머지 빈 반복 셀은 그냥 비워두면 된다")
// ─────────────────────────────────────────────────────────────────────────────

describe('F. 잉여 슬롯 공백 처리', () => {
  const sheet4rows = makeSheet({
    rows: [
      ['{{상품명}}', '{{수량}}'],
      ['{{상품명}}', '{{수량}}'],
      ['{{상품명}}', '{{수량}}'],
      ['{{상품명}}', '{{수량}}'],
    ],
    merges: [
      { s: { r: 5, c: 0 }, e: { r: 5, c: 1 } }, // repeatRegion 밖 — 무관 병합(변경 없음 확인용)
    ],
    cellFormatting: [[{}, {}], [{}, {}], [{}, {}], [{}, {}]],
    repeatRegion: { startRow: 0, endRow: 3 },
  })
  const data2items: ContractSubstitutionData = {
    상품목록: [
      { 상품명: '카메라 A', 수량: '1', 금액: '100,000원' },
      { 상품명: '렌즈 B', 수량: '2', 금액: '150,000원' },
    ],
  }

  it('F-1: 앞 N행은 항목값, 잉여 행은 {{}} 원문도 이전 값도 아닌 빈 문자열', () => {
    const result = substituteSpreadsheetDocument(makeDoc(sheet4rows), data2items)
    const rows = result.sheets[0].rows
    expect(rows[0]).toEqual(['카메라 A', '1'])
    expect(rows[1]).toEqual(['렌즈 B', '2'])
    // 잉여 행(2·3) — 원문 {{}} 노출 금지 + 직전 항목(렌즈 B) 값 잔존 금지 + 빈 문자열이어야 함
    expect(rows[2]).toEqual(['', ''])
    expect(rows[3]).toEqual(['', ''])
  })

  it('F-2: 전체 행 수가 항목 수와 무관하게 항상 템플릿 행 수(T=4)로 고정됨', () => {
    const zeroItems = substituteSpreadsheetDocument(makeDoc(sheet4rows), { 상품목록: [] })
    const oneItem = substituteSpreadsheetDocument(makeDoc(sheet4rows), {
      상품목록: [{ 상품명: '단독상품', 수량: '1', 금액: '1,000원' }],
    })
    const twoItems = substituteSpreadsheetDocument(makeDoc(sheet4rows), data2items)
    expect(zeroItems.sheets[0].rows.length).toBe(4)
    expect(oneItem.sheets[0].rows.length).toBe(4)
    expect(twoItems.sheets[0].rows.length).toBe(4)
  })

  it('F-3: 행 수·위치가 바뀌지 않으므로 merges가 원본과 완전히 동일(재계산 없음)', () => {
    const result = substituteSpreadsheetDocument(makeDoc(sheet4rows), data2items)
    expect(result.sheets[0].merges).toEqual(sheet4rows.merges)
  })
})
