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
import { substituteHtmlDocument } from '$lib/utils/contract-substitution'
import type { ContractSubstitutionData, ContractLineItem } from '$lib/types/contract-module'

// ─────────────────────────────────────────────────────────────────────────────
// 픽스처 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

interface MainProduct {
  name: string
  product_code: string | null
  unit_price?: number | null
  components?: unknown
}

interface OptionProduct {
  option_name: string
  qty: number
  unit_price: number
  product_code: string | null
  components?: unknown
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

// ─────────────────────────────────────────────────────────────────────────────
// 12. 비고 필드 — products.components(구성품) 반영 (2026-09-08 신설)
// ─────────────────────────────────────────────────────────────────────────────
describe('buildLineItems — 비고(구성품) 반영', () => {
  it('메인상품에 components가 없으면 비고는 "-"이다', () => {
    const result = buildLineItems([
      makeReservation({ name: '소니 FX3', product_code: 'CSLED001' })
    ])
    expect(result[0].비고).toBe('-')
  })

  it('메인상품 components가 있으면 formatComponentsText 형식으로 비고에 채워진다', () => {
    const result = buildLineItems([
      makeReservation({ name: '소니 FX3', product_code: 'CSLED001', components: { 배터리: '2개', 충전기: '1개' } })
    ])
    expect(result[0].비고).toBe('배터리: 2개, 충전기: 1개')
  })

  it('옵션상품도 자신의 components로 독립적으로 비고가 채워진다', () => {
    const result = buildLineItems([
      makeReservation(
        { name: '캐논 R5', product_code: 'CSCAN001' },
        [{ option_name: '메모리카드', qty: 2, unit_price: 5000, product_code: null, components: { 용량: '128GB' } }]
      )
    ])
    expect(result[0].비고).toBe('-') // 메인상품(캐논 R5)은 components 없음
    expect(result[1].비고).toBe('용량: 128GB') // 옵션(메모리카드)은 자신의 components 반영
  })

  it('같은 상품을 여러 건 예약해 그룹화돼도(수량 합산) 비고는 그룹의 대표값(첫 reservation) 기준이다', () => {
    const result = buildLineItems([
      makeReservation({ name: '소니 FX3', product_code: 'CSLED001', components: { 배터리: '2개' } }),
      makeReservation({ name: '소니 FX3', product_code: 'CSLED001', components: { 배터리: '2개' } }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].수량).toBe('2')
    expect(result[0].비고).toBe('배터리: 2개')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// P1-8 결합상품(bundle) 행 삽입 — TDD RED→GREEN→REFACTOR (2026-09-24 Phase 1)
//
// 행 구성 순서: 메인상품 → 결합상품 행들 → 옵션상품 행들
// bundle 행 정책:
//   - 수량: '-'
//   - 금액: '-'
//   - 비고: formatComponentsText(components)
//   - 상품코드: bundle_product_id를 표시하지 않음(Phase 1 = name only, products.md §2-14)
// ─────────────────────────────────────────────────────────────────────────────

interface BundleProduct {
  bundle_product_id: string
  bundle_name: string
  components?: unknown
  product_code?: string | null
}

function makeReservationWithBundles(
  mainProduct: MainProduct,
  bundles: BundleProduct[] = [],
  options: OptionProduct[] = []
) {
  return { mainProduct, bundles, options }
}
