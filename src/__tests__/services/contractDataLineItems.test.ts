/**
 * contractDataLineItems.test.ts
 * Stage 1 TDD — ContractSubstitutionData 배열 필드(상품목록) 확장
 *
 * Harness Flow v3.2 | RED → GREEN → REFACTOR
 *
 * 이 테스트는 buildLineItems() 순수 함수를 단위 테스트한다.
 * DB 연결 불필요 — 완전한 순수 함수 테스트.
 *
 * 검증 항목:
 *   1. 빈 배열 입력 → 빈 배열 반환
 *   2. reservation 1건 + 옵션 0개 → 메인상품 1행만 반환
 *   3. reservation 1건 + 옵션 1개 → 2행(메인+옵션)
 *   4. reservation 1건 + 옵션 N개 → N+1행(메인+옵션들)
 *   5. reservation N건 + 옵션 없음 → N행(메인들)
 *   6. reservation 2건, 각각 옵션 수 다름 → 올바른 순서 평탄화
 *   7. 옵션 금액 = unit_price × qty (원화 포맷)
 *   8. 메인상품 상품코드 null → 상품코드 필드 없음
 *   9. 옵션상품 product_code null → 상품코드 필드 없음
 *  10. ContractSubstitutionData 타입에 기존 16개 스칼라 필드가 모두 유지됨 (타입 회귀)
 *  11. 메인상품 수량 = 같은 상품(이름+품번)의 실제 예약 건수, 옵션 수량은
 *      reservation_options.qty 원문 (2026-08-28 Stephen 정정 — "항상 1" 아님)
 *  12. 같은 메인상품을 여러 건 예약하면 1행으로 묶이고 수량이 합산됨 + 그 각 예약의
 *      옵션들은 병합 없이 그룹 뒤에 이어붙음
 */

import { describe, it, expect } from 'vitest'
import { buildLineItems } from '$lib/utils/contractLineItems'
import type { ContractSubstitutionData, ContractLineItem } from '$lib/types/contract-module'

// ─────────────────────────────────────────────────────────────────────────────
// 픽스처 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

interface MainProduct {
  name: string
  product_code: string | null
}

interface OptionProduct {
  option_name: string
  qty: number
  unit_price: number
  product_code: string | null
}

function makeReservation(
  mainProduct: MainProduct,
  options: OptionProduct[] = []
) {
  return { mainProduct, options }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. 빈 배열 입력
// ─────────────────────────────────────────────────────────────────────────────
describe('buildLineItems — 빈 배열', () => {
  it('예약이 없으면 빈 배열을 반환한다', () => {
    expect(buildLineItems([])).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. reservation 1건 + 옵션 0개
// ─────────────────────────────────────────────────────────────────────────────
describe('buildLineItems — reservation 1건, 옵션 0개', () => {
  it('메인상품 1행만 반환한다', () => {
    const result = buildLineItems([
      makeReservation({ name: '소니 FX3', product_code: 'CSLED001' }, [])
    ])
    expect(result).toHaveLength(1)
    expect(result[0].상품명).toBe('소니 FX3')
    expect(result[0].상품코드).toBe('CSLED001')
    expect(result[0].수량).toBe('1')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. reservation 1건 + 옵션 1개
// ─────────────────────────────────────────────────────────────────────────────
describe('buildLineItems — reservation 1건, 옵션 1개', () => {
  it('메인상품 1행 + 옵션 1행 = 2행 반환한다', () => {
    const result = buildLineItems([
      makeReservation(
        { name: '소니 FX3', product_code: 'CSLED001' },
        [{ option_name: '메모리카드 128GB', qty: 1, unit_price: 5000, product_code: null }]
      )
    ])
    expect(result).toHaveLength(2)
    expect(result[0].상품명).toBe('소니 FX3')
    expect(result[1].상품명).toBe('메모리카드 128GB')
  })

  it('옵션행에 수량이 올바르게 채워진다', () => {
    const result = buildLineItems([
      makeReservation(
        { name: '소니 FX3', product_code: 'CSLED001' },
        [{ option_name: '메모리카드 128GB', qty: 2, unit_price: 5000, product_code: null }]
      )
    ])
    expect(result[1].수량).toBe('2')
  })

  it('옵션행 금액 = unit_price × qty 원화 포맷', () => {
    const result = buildLineItems([
      makeReservation(
        { name: '소니 FX3', product_code: 'CSLED001' },
        [{ option_name: '메모리카드 128GB', qty: 2, unit_price: 5000, product_code: null }]
      )
    ])
    // 5000 × 2 = 10000 → '10,000원'
    expect(result[1].금액).toBe('10,000원')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. reservation 1건 + 옵션 N개
// ─────────────────────────────────────────────────────────────────────────────
describe('buildLineItems — reservation 1건, 옵션 N개', () => {
  it('메인 1행 + 옵션 N행 순서 유지', () => {
    const result = buildLineItems([
      makeReservation(
        { name: '캐논 EOS R5', product_code: 'CSCAN001' },
        [
          { option_name: '삼각대', qty: 1, unit_price: 10000, product_code: null },
          { option_name: 'ND필터', qty: 3, unit_price: 2000, product_code: 'CSFLT001' },
          { option_name: '배터리 그립', qty: 1, unit_price: 15000, product_code: null },
        ]
      )
    ])
    expect(result).toHaveLength(4)
    expect(result[0].상품명).toBe('캐논 EOS R5')
    expect(result[1].상품명).toBe('삼각대')
    expect(result[2].상품명).toBe('ND필터')
    expect(result[3].상품명).toBe('배터리 그립')
  })

  it('각 옵션행 금액이 개별 계산됨 (unit_price × qty)', () => {
    const result = buildLineItems([
      makeReservation(
        { name: '캐논 EOS R5', product_code: 'CSCAN001' },
        [
          { option_name: '삼각대', qty: 1, unit_price: 10000, product_code: null },
          { option_name: 'ND필터', qty: 3, unit_price: 2000, product_code: null },
        ]
      )
    ])
    expect(result[1].금액).toBe('10,000원')
    expect(result[2].금액).toBe('6,000원')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. reservation N건, 옵션 없음
// ─────────────────────────────────────────────────────────────────────────────
describe('buildLineItems — reservation N건, 옵션 없음', () => {
  it('N건 예약 × 메인상품만 = N행', () => {
    const result = buildLineItems([
      makeReservation({ name: '소니 FX3', product_code: 'CSLED001' }),
      makeReservation({ name: '캐논 EOS R5', product_code: 'CSCAN001' }),
      makeReservation({ name: '니콘 Z8', product_code: 'CSNKN001' }),
    ])
    expect(result).toHaveLength(3)
    expect(result[0].상품명).toBe('소니 FX3')
    expect(result[1].상품명).toBe('캐논 EOS R5')
    expect(result[2].상품명).toBe('니콘 Z8')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. reservation N건, 각각 옵션 수 다름 → 올바른 순서 평탄화
// ─────────────────────────────────────────────────────────────────────────────
describe('buildLineItems — reservation 2건, 옵션 수 혼합', () => {
  it('행 순서: [메인A, 옵션A1, 메인B, 옵션B1, 옵션B2]', () => {
    const result = buildLineItems([
      makeReservation(
        { name: '소니 FX3', product_code: 'CSLED001' },
        [{ option_name: '메모리카드', qty: 1, unit_price: 5000, product_code: null }]
      ),
      makeReservation(
        { name: '캐논 EOS R5', product_code: 'CSCAN001' },
        [
          { option_name: '삼각대', qty: 1, unit_price: 10000, product_code: null },
          { option_name: 'ND필터', qty: 2, unit_price: 3000, product_code: null },
        ]
      ),
    ])
    expect(result).toHaveLength(5)
    expect(result[0].상품명).toBe('소니 FX3')
    expect(result[1].상품명).toBe('메모리카드')
    expect(result[2].상품명).toBe('캐논 EOS R5')
    expect(result[3].상품명).toBe('삼각대')
    expect(result[4].상품명).toBe('ND필터')
  })

  it('전체 행 수 = 메인상품 수 + 모든 옵션 수 합계', () => {
    const result = buildLineItems([
      makeReservation(
        { name: 'A', product_code: null },
        [
          { option_name: 'A-opt1', qty: 1, unit_price: 1000, product_code: null },
          { option_name: 'A-opt2', qty: 1, unit_price: 2000, product_code: null },
        ]
      ),
      makeReservation(
        { name: 'B', product_code: null },
        [] // 옵션 없음
      ),
      makeReservation(
        { name: 'C', product_code: null },
        [{ option_name: 'C-opt1', qty: 3, unit_price: 500, product_code: null }]
      ),
    ])
    // 총: 3(메인) + 2(A옵션) + 0(B옵션) + 1(C옵션) = 6행
    expect(result).toHaveLength(6)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. 메인상품 수량 = 실제 예약 건수 (2026-08-28 정정 — "항상 1" 아님)
// ─────────────────────────────────────────────────────────────────────────────
describe('buildLineItems — 메인상품 수량 = 실제 예약 건수', () => {
  it('예약이 1건이면 수량은 "1"이다', () => {
    const result = buildLineItems([
      makeReservation({ name: '소니 FX3', product_code: 'CSLED001' })
    ])
    expect(result[0].수량).toBe('1')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 12. 같은 메인상품(이름+품번 동일) 여러 건 예약 → 1행으로 묶이고 수량 합산
// (2026-08-28 Stephen 정정: "같은 카메라 2대 예약 시 계약서엔 1줄 + 수량=2로 표시")
// ─────────────────────────────────────────────────────────────────────────────
describe('buildLineItems — 동일 메인상품 여러 건 그룹화', () => {
  it('동일 상품 2건 예약 → 1행 + 수량 "2"', () => {
    const result = buildLineItems([
      makeReservation({ name: '소니 FX3', product_code: 'CSLED001' }),
      makeReservation({ name: '소니 FX3', product_code: 'CSLED001' }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].상품명).toBe('소니 FX3')
    expect(result[0].수량).toBe('2')
  })

  it('동일 상품 3건 + 다른 상품 1건 → 2행(수량 3, 수량 1), 최초 등장 순서 유지', () => {
    const result = buildLineItems([
      makeReservation({ name: '소니 FX3', product_code: 'CSLED001' }),
      makeReservation({ name: '캐논 EOS R5', product_code: 'CSCAN001' }),
      makeReservation({ name: '소니 FX3', product_code: 'CSLED001' }),
      makeReservation({ name: '소니 FX3', product_code: 'CSLED001' }),
    ])
    expect(result).toHaveLength(2)
    expect(result[0].상품명).toBe('소니 FX3')
    expect(result[0].수량).toBe('3')
    expect(result[1].상품명).toBe('캐논 EOS R5')
    expect(result[1].수량).toBe('1')
  })

  it('동일 상품 그룹에 속한 여러 예약의 옵션은 병합 없이 그룹 뒤에 순서대로 이어붙는다', () => {
    const result = buildLineItems([
      makeReservation(
        { name: '소니 FX3', product_code: 'CSLED001' },
        [{ option_name: '메모리카드', qty: 1, unit_price: 5000, product_code: null }]
      ),
      makeReservation(
        { name: '소니 FX3', product_code: 'CSLED001' },
        [{ option_name: '삼각대', qty: 1, unit_price: 10000, product_code: null }]
      ),
    ])
    // [소니FX3(수량2), 메모리카드, 삼각대]
    expect(result).toHaveLength(3)
    expect(result[0].상품명).toBe('소니 FX3')
    expect(result[0].수량).toBe('2')
    expect(result[1].상품명).toBe('메모리카드')
    expect(result[2].상품명).toBe('삼각대')
  })

  it('품번이 다르면(동일 이름이라도) 별도 그룹으로 취급한다', () => {
    const result = buildLineItems([
      makeReservation({ name: '카메라 렌탈', product_code: 'CSLED001' }),
      makeReservation({ name: '카메라 렌탈', product_code: 'CSLED002' }),
    ])
    expect(result).toHaveLength(2)
    expect(result[0].수량).toBe('1')
    expect(result[1].수량).toBe('1')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 8. 메인상품 product_code null → 상품코드 필드 없음/undefined
// ─────────────────────────────────────────────────────────────────────────────
describe('buildLineItems — product_code null 처리', () => {
  it('메인상품 product_code가 null이면 상품코드 필드가 없다', () => {
    const result = buildLineItems([
      makeReservation({ name: '소니 FX3', product_code: null })
    ])
    expect(result[0].상품코드).toBeUndefined()
  })

  it('메인상품 product_code가 있으면 상품코드 필드가 채워진다', () => {
    const result = buildLineItems([
      makeReservation({ name: '소니 FX3', product_code: 'CSLED001' })
    ])
    expect(result[0].상품코드).toBe('CSLED001')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 9. 옵션상품 product_code null → 상품코드 필드 없음/undefined
// ─────────────────────────────────────────────────────────────────────────────
describe('buildLineItems — 옵션상품 product_code null 처리', () => {
  it('옵션 product_code가 null이면 상품코드 필드가 없다', () => {
    const result = buildLineItems([
      makeReservation(
        { name: '소니 FX3', product_code: 'CSLED001' },
        [{ option_name: '메모리카드', qty: 1, unit_price: 5000, product_code: null }]
      )
    ])
    expect(result[1].상품코드).toBeUndefined()
  })

  it('옵션 product_code가 있으면 상품코드 필드가 채워진다', () => {
    const result = buildLineItems([
      makeReservation(
        { name: '소니 FX3', product_code: 'CSLED001' },
        [{ option_name: 'ND필터', qty: 1, unit_price: 3000, product_code: 'CSFLT001' }]
      )
    ])
    expect(result[1].상품코드).toBe('CSFLT001')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 10. ContractSubstitutionData 타입 회귀 — 기존 16개 스칼라 필드 유지
// ─────────────────────────────────────────────────────────────────────────────
describe('ContractSubstitutionData — 기존 16개 스칼라 필드 타입 회귀', () => {
  it('ContractSubstitutionData가 기존 16개 스칼라 필드를 모두 유지한다', () => {
    // 타입 레벨 컴파일 검증 — 런타임에서는 단순히 할당이 성공하는지 확인
    const data: ContractSubstitutionData = {
      고객이름:     '홍길동',
      연락처:       '010-0000-0000',
      이메일:       'test@example.com',
      주소:         '서울시',
      예약코드:     'RV-001',
      상품코드:     'CSLED001',
      상품명:       '소니 FX3',
      수량:         '1',
      수령형태:     '택배',
      수령일시:     '2026-09-01',
      반납형태:     '택배',
      반납일시:     '2026-09-03',
      기본대여요금: '100,000원',
      할인금액:     '0원',
      부가세:       '10,000원',
      최종합계:     '110,000원',
    }
    // 모든 16개 필드가 존재하는지 확인
    const keys: (keyof ContractSubstitutionData)[] = [
      '고객이름', '연락처', '이메일', '주소',
      '예약코드', '상품코드', '상품명', '수량',
      '수령형태', '수령일시', '반납형태', '반납일시',
      '기본대여요금', '할인금액', '부가세', '최종합계',
    ]
    for (const key of keys) {
      expect(key in data || data[key] === undefined).toBe(true)
    }
  })

  it('상품목록 필드가 ContractSubstitutionData에 추가됐다', () => {
    const data: ContractSubstitutionData = {
      상품목록: [
        { 상품명: '소니 FX3', 상품코드: 'CSLED001', 수량: '1', 금액: '-' },
        { 상품명: '메모리카드', 수량: '1', 금액: '5,000원' },
      ],
    }
    expect(data.상품목록).toHaveLength(2)
    expect(data.상품목록?.[0].상품명).toBe('소니 FX3')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 11. 메인상품 금액은 '-' (per-reservation 금액 데이터 없음)
// ─────────────────────────────────────────────────────────────────────────────
describe('buildLineItems — 메인상품 금액 기본값', () => {
  it('메인상품 행의 금액은 "-"이다 (현재 per-reservation 분리 금액 없음)', () => {
    const result = buildLineItems([
      makeReservation({ name: '소니 FX3', product_code: 'CSLED001' })
    ])
    expect(result[0].금액).toBe('-')
  })
})
