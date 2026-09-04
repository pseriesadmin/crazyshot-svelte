/**
 * cartShippingFee.test.ts
 * 배송비(왕복/배송/반납요금) — 3-way 배타 규칙 검증 (2026-08-30 Stephen 확정)
 *
 * 규칙:
 *   ① 수령·반납 둘 다 배송   → 왕복요금(round_trip_fee) 1회만
 *   ② 수령만 배송(반납 아님) → 배송요금(delivery_fee) 1회만
 *   ③ 반납만 배송(수령 아님) → 반납요금(return_fee) 1회만
 *   그 외                     → 0
 * 세 조건은 상호 배타적 — 항상 최대 1개 요금만 반환(스태킹 없음).
 *
 * 테스트 전략:
 *   - 순수 함수 단위 테스트 (DB 연동 없음)
 *   - 핵심 케이스: 3-way 배타 분기 각각, 곱연산 금지, 플래그 false 전체미적용, enable=false
 */

import { describe, it, expect } from 'vitest'
import { calcShippingFee, calcShippingDiscountRate, isFreeDeliveryCouponBlocked, computeReturnVisibleTabs, type DeliveryFeeDiscountTier, type DiscountConditionItem, type DeliveryTypeMethod } from '$lib/utils/cartShippingFee'

// ── 주의: DeliveryFeeDiscountTier.condition_types에 'rental_item'이 추가돼야 아래 테스트가 GREEN
// (현재 미추가 상태 = RED)

// ── 테스트용 기본 배송 설정 ───────────────────────────────────────────────────
const SHIPPING_ON = {
  enable_round_trip: true,
  round_trip_fee: 5000,
  enable_delivery: true,
  delivery_fee: 3000,
  enable_return: true,
  return_fee: 2000,
}

// ── 단일 아이템 헬퍼 ─────────────────────────────────────────────────────────
function makeItem(opts: {
  pickupIsDelivery: boolean
  returnIsDelivery: boolean
  shipping_round_trip?: boolean | null
  shipping_delivery?: boolean | null
  shipping_return?: boolean | null
}) {
  return {
    pickupIsDelivery:   opts.pickupIsDelivery,
    returnIsDelivery:   opts.returnIsDelivery,
    shipping_round_trip: opts.shipping_round_trip ?? true,
    shipping_delivery:   opts.shipping_delivery   ?? true,
    shipping_return:     opts.shipping_return     ?? true,
  }
}

// ════════════════════════════════════════════════════════════════════
describe('calcShippingFee — 왕복/배송/반납요금 3-way 배타 부과', () => {
  it('수령·반납 둘 다 배송 → 왕복요금(5000)만 반환', () => {
    const items = [makeItem({ pickupIsDelivery: true, returnIsDelivery: true })]
    expect(calcShippingFee(SHIPPING_ON, items)).toBe(5000)
  })

  it('수령만 배송(반납은 방문 등) → 배송요금(3000)만 반환', () => {
    const items = [makeItem({ pickupIsDelivery: true, returnIsDelivery: false })]
    expect(calcShippingFee(SHIPPING_ON, items)).toBe(3000)
  })

  it('반납만 배송(수령은 방문 등) → 반납요금(2000)만 반환', () => {
    const items = [makeItem({ pickupIsDelivery: false, returnIsDelivery: true })]
    expect(calcShippingFee(SHIPPING_ON, items)).toBe(2000)
  })

  it('수령·반납 둘 다 배송 아님 → 0', () => {
    const items = [makeItem({ pickupIsDelivery: false, returnIsDelivery: false })]
    expect(calcShippingFee(SHIPPING_ON, items)).toBe(0)
  })

  it('상품 3개 모두 동일 조건이어도 곱연산 없이 여전히 1회만', () => {
    const item = makeItem({ pickupIsDelivery: true, returnIsDelivery: true })
    expect(calcShippingFee(SHIPPING_ON, [item, item, item])).toBe(5000)
  })

  it('enable_round_trip=false → 왕복 조건이어도 0', () => {
    const items = [makeItem({ pickupIsDelivery: true, returnIsDelivery: true })]
    expect(calcShippingFee({ ...SHIPPING_ON, enable_round_trip: false }, items)).toBe(0)
  })

  it('enable_delivery=false → 수령만배송 조건이어도 0', () => {
    const items = [makeItem({ pickupIsDelivery: true, returnIsDelivery: false })]
    expect(calcShippingFee({ ...SHIPPING_ON, enable_delivery: false }, items)).toBe(0)
  })

  it('enable_return=false → 반납만배송 조건이어도 0', () => {
    const items = [makeItem({ pickupIsDelivery: false, returnIsDelivery: true })]
    expect(calcShippingFee({ ...SHIPPING_ON, enable_return: false }, items)).toBe(0)
  })

  it('상품 플래그(shipping_round_trip) 하나라도 false → 왕복 티어 전체 미적용(0) [보수적 처리]', () => {
    const items = [
      makeItem({ pickupIsDelivery: true, returnIsDelivery: true, shipping_round_trip: true }),
      makeItem({ pickupIsDelivery: true, returnIsDelivery: true, shipping_round_trip: false }),
    ]
    expect(calcShippingFee(SHIPPING_ON, items)).toBe(0)
  })

  it('상품 플래그(shipping_delivery) 하나라도 false → 배송 티어 전체 미적용(0)', () => {
    const items = [
      makeItem({ pickupIsDelivery: true, returnIsDelivery: false, shipping_delivery: true }),
      makeItem({ pickupIsDelivery: true, returnIsDelivery: false, shipping_delivery: false }),
    ]
    expect(calcShippingFee(SHIPPING_ON, items)).toBe(0)
  })

  it('상품 플래그(shipping_return) 하나라도 false → 반납 티어 전체 미적용(0)', () => {
    const items = [
      makeItem({ pickupIsDelivery: false, returnIsDelivery: true, shipping_return: true }),
      makeItem({ pickupIsDelivery: false, returnIsDelivery: true, shipping_return: false }),
    ]
    expect(calcShippingFee(SHIPPING_ON, items)).toBe(0)
  })

  it('체크된 아이템 없음 → 0', () => {
    expect(calcShippingFee(SHIPPING_ON, [])).toBe(0)
  })

  it('shippingSettings null → 0', () => {
    const items = [makeItem({ pickupIsDelivery: true, returnIsDelivery: true })]
    expect(calcShippingFee(null, items)).toBe(0)
  })

  it('각 요금이 null이어도 조건 충족 시 0으로 안전 처리(null-safe)', () => {
    const roundTripItems = [makeItem({ pickupIsDelivery: true, returnIsDelivery: true })]
    expect(calcShippingFee({ ...SHIPPING_ON, round_trip_fee: null }, roundTripItems)).toBe(0)

    const deliveryOnlyItems = [makeItem({ pickupIsDelivery: true, returnIsDelivery: false })]
    expect(calcShippingFee({ ...SHIPPING_ON, delivery_fee: null }, deliveryOnlyItems)).toBe(0)

    const returnOnlyItems = [makeItem({ pickupIsDelivery: false, returnIsDelivery: true })]
    expect(calcShippingFee({ ...SHIPPING_ON, return_fee: null }, returnOnlyItems)).toBe(0)
  })

  it('여러 아이템 중 하나라도 수령=배송 + 다른 하나가 반납=배송이면(서로 다른 아이템) → 왕복요금(OR 판정 후 배타 선택)', () => {
    const items = [
      makeItem({ pickupIsDelivery: true, returnIsDelivery: false }),
      makeItem({ pickupIsDelivery: false, returnIsDelivery: true }),
    ]
    // anyPickupDelivery=true, anyReturnDelivery=true → 카트 전체 기준 "둘 다 배송" 판정 → 왕복요금
    expect(calcShippingFee(SHIPPING_ON, items)).toBe(5000)
  })

  it('세 요금 전부 다른 금액으로 자유롭게 설정 가능(자유도 보장 확인)', () => {
    const custom = { enable_round_trip: true, round_trip_fee: 9999, enable_delivery: true, delivery_fee: 1111, enable_return: true, return_fee: 4321 }
    expect(calcShippingFee(custom, [makeItem({ pickupIsDelivery: true, returnIsDelivery: true })])).toBe(9999)
    expect(calcShippingFee(custom, [makeItem({ pickupIsDelivery: true, returnIsDelivery: false })])).toBe(1111)
    expect(calcShippingFee(custom, [makeItem({ pickupIsDelivery: false, returnIsDelivery: true })])).toBe(4321)
  })
})

// ════════════════════════════════════════════════════════════════════
// calcShippingDiscountRate — 배송료 우대설정(대여금액+조건 만족 시 배송비 할인)
// (TASK.md "배송료 우대설정" 2026-08-29 Stephen 확정: 적용대상=배송비 전체합계,
//  다중매칭=최유리 1개만 적용, 조건판정=조건종류별 체크된 항목 OR, 금액기준=otSubtotal.
//  같은 날 후속 확정: 한 조합에 조건을 여러 개 선택하면 AND로 결합 — 선택된 조건 전부가
//  (각각 독립적으로 OR 판정된) 충족 상태여야 그 조합이 매칭됨)
// ════════════════════════════════════════════════════════════════════
function makeTier(opts: {
  min_rental_amount: number
  condition_types: Array<'long_term_rental' | 'sale_only_purchase' | 'rental_item'>
  discount_rate: number
}): DeliveryFeeDiscountTier {
  return { ...opts }
}

function makeDiscountItem(opts: { rentalDays?: number; saleOnlyPurchase?: boolean }): DiscountConditionItem {
  return {
    rentalDays: opts.rentalDays ?? 1,
    saleOnlyPurchase: opts.saleOnlyPurchase ?? false,
  }
}

describe('calcShippingDiscountRate — 배송료 우대설정 최유리 조합 판정', () => {
  it('등록된 조합 0개 → 0', () => {
    const items = [makeDiscountItem({ rentalDays: 5 })]
    expect(calcShippingDiscountRate([], 100000, items)).toBe(0)
  })

  it('otSubtotal이 임계값 미만 → 0', () => {
    const tiers = [makeTier({ min_rental_amount: 100000, condition_types: ['long_term_rental'], discount_rate: 1 })]
    const items = [makeDiscountItem({ rentalDays: 5 })]
    expect(calcShippingDiscountRate(tiers, 99999, items)).toBe(0)
  })

  it('otSubtotal이 임계값과 정확히 같음(>=) → 매칭(포함)', () => {
    const tiers = [makeTier({ min_rental_amount: 100000, condition_types: ['long_term_rental'], discount_rate: 1 })]
    const items = [makeDiscountItem({ rentalDays: 5 })]
    expect(calcShippingDiscountRate(tiers, 100000, items)).toBe(1)
  })

  it('장기대여 조건 — 체크된 항목 중 1개만 3일 이상이어도(OR) 매칭', () => {
    const tiers = [makeTier({ min_rental_amount: 0, condition_types: ['long_term_rental'], discount_rate: 0.5 })]
    const items = [makeDiscountItem({ rentalDays: 1 }), makeDiscountItem({ rentalDays: 3 })]
    expect(calcShippingDiscountRate(tiers, 0, items)).toBe(0.5)
  })

  it('장기대여 조건 — 모든 항목이 2일 이하면 미적용', () => {
    const tiers = [makeTier({ min_rental_amount: 0, condition_types: ['long_term_rental'], discount_rate: 0.5 })]
    const items = [makeDiscountItem({ rentalDays: 1 }), makeDiscountItem({ rentalDays: 2 })]
    expect(calcShippingDiscountRate(tiers, 0, items)).toBe(0)
  })

  it('판매상품구매 조건 — 체크된 항목 중 1개만 판매상품이어도(OR) 매칭', () => {
    const tiers = [makeTier({ min_rental_amount: 0, condition_types: ['sale_only_purchase'], discount_rate: 1 })]
    const items = [makeDiscountItem({}), makeDiscountItem({ saleOnlyPurchase: true })]
    expect(calcShippingDiscountRate(tiers, 0, items)).toBe(1)
  })

  it('조건 타입 불일치 — 장기대여 룰만 있는데 판매상품만 체크됨 → 미적용', () => {
    const tiers = [makeTier({ min_rental_amount: 0, condition_types: ['long_term_rental'], discount_rate: 1 })]
    const items = [makeDiscountItem({ rentalDays: 1, saleOnlyPurchase: true })]
    expect(calcShippingDiscountRate(tiers, 0, items)).toBe(0)
  })

  it('여러 조합 동시 매칭 → 최대 할인율(무료) 우선 적용, 스태킹 없음', () => {
    const tiers = [
      makeTier({ min_rental_amount: 0, condition_types: ['long_term_rental'], discount_rate: 0.5 }),
      makeTier({ min_rental_amount: 0, condition_types: ['long_term_rental'], discount_rate: 1 }),
      makeTier({ min_rental_amount: 0, condition_types: ['long_term_rental'], discount_rate: 0 }),
    ]
    const items = [makeDiscountItem({ rentalDays: 5 })]
    expect(calcShippingDiscountRate(tiers, 0, items)).toBe(1)
  })

  it('임계값을 넘는 조합만 후보에 포함 — 더 유리해도 임계값 미달이면 제외', () => {
    const tiers = [
      makeTier({ min_rental_amount: 50000, condition_types: ['long_term_rental'], discount_rate: 0.5 }),
      makeTier({ min_rental_amount: 500000, condition_types: ['long_term_rental'], discount_rate: 1 }),
    ]
    const items = [makeDiscountItem({ rentalDays: 5 })]
    expect(calcShippingDiscountRate(tiers, 100000, items)).toBe(0.5)
  })

  it('삭제/미체크 항목은 애초에 items 배열에서 제외되어 있어야 함(호출부 책임) — 빈 배열 → 0', () => {
    const tiers = [makeTier({ min_rental_amount: 0, condition_types: ['long_term_rental'], discount_rate: 1 })]
    expect(calcShippingDiscountRate(tiers, 100000, [])).toBe(0)
  })

  it('기본왕복배송요금(할인율 0) 조합만 매칭 → 0 (다른 미매칭과 결과상 구분 안 되지만 로직상 정상)', () => {
    const tiers = [makeTier({ min_rental_amount: 0, condition_types: ['sale_only_purchase'], discount_rate: 0 })]
    const items = [makeDiscountItem({ saleOnlyPurchase: true })]
    expect(calcShippingDiscountRate(tiers, 0, items)).toBe(0)
  })

  // ── 다중 조건 선택(AND 결합) — 2026-08-29 후속 확정 ────────────────────
  it('조건 2개 선택(AND) — 장기대여 항목과 판매상품 항목이 각각(다른 항목으로) 존재하면 매칭', () => {
    const tiers = [makeTier({ min_rental_amount: 0, condition_types: ['long_term_rental', 'sale_only_purchase'], discount_rate: 1 })]
    const items = [makeDiscountItem({ rentalDays: 5 }), makeDiscountItem({ saleOnlyPurchase: true })]
    expect(calcShippingDiscountRate(tiers, 0, items)).toBe(1)
  })

  it('조건 2개 선택(AND) — 장기대여 조건만 만족하고 판매상품 조건은 미만족이면 미적용', () => {
    const tiers = [makeTier({ min_rental_amount: 0, condition_types: ['long_term_rental', 'sale_only_purchase'], discount_rate: 1 })]
    const items = [makeDiscountItem({ rentalDays: 5, saleOnlyPurchase: false })]
    expect(calcShippingDiscountRate(tiers, 0, items)).toBe(0)
  })

  it('조건 2개 선택(AND) — 동일 항목 하나가 두 조건을 동시에 만족해도 매칭', () => {
    const tiers = [makeTier({ min_rental_amount: 0, condition_types: ['long_term_rental', 'sale_only_purchase'], discount_rate: 0.5 })]
    const items = [makeDiscountItem({ rentalDays: 5, saleOnlyPurchase: true })]
    expect(calcShippingDiscountRate(tiers, 0, items)).toBe(0.5)
  })

  it('단일조건 조합과 다중조건(AND) 조합이 동시에 매칭 → 더 유리한 쪽 적용', () => {
    const tiers = [
      makeTier({ min_rental_amount: 0, condition_types: ['long_term_rental'], discount_rate: 0.5 }),
      makeTier({ min_rental_amount: 0, condition_types: ['long_term_rental', 'sale_only_purchase'], discount_rate: 1 }),
    ]
    const items = [makeDiscountItem({ rentalDays: 5 }), makeDiscountItem({ saleOnlyPurchase: true })]
    expect(calcShippingDiscountRate(tiers, 0, items)).toBe(1)
  })

  // ── 신규 조건: rental_item (2026-09-01) ──────────────────────────────────
  // 'rental_item': !saleOnlyPurchase인 항목이 1개 이상 존재하면 OR 충족
  it('[rental_item] 대여상품 조건 — 체크된 항목 중 1개만 대여상품이어도(OR) 매칭', () => {
    const tiers = [makeTier({ min_rental_amount: 0, condition_types: ['rental_item'], discount_rate: 1 })]
    const items = [makeDiscountItem({ saleOnlyPurchase: true }), makeDiscountItem({ saleOnlyPurchase: false })]
    expect(calcShippingDiscountRate(tiers, 0, items)).toBe(1)
  })

  it('[rental_item] 대여상품 조건 — 대여상품만 있는 카트 → 매칭', () => {
    const tiers = [makeTier({ min_rental_amount: 0, condition_types: ['rental_item'], discount_rate: 0.5 })]
    const items = [makeDiscountItem({ saleOnlyPurchase: false }), makeDiscountItem({ saleOnlyPurchase: false })]
    expect(calcShippingDiscountRate(tiers, 0, items)).toBe(0.5)
  })

  // EC-1: 기존 long_term_rental 단독 티어 — Q2=a 채택 후 금액 기준이 rental-only로 바뀜.
  //  판매전용상품 포함 총액만 임계값 초과하고 대여상품 금액만으로는 미달이면 → 미적용(회귀, Stephen 인지·승인).
  it('[EC-1] 장기대여 단독 티어 — 대여상품 금액(otRentalOnlySubtotal)만 임계값 미달 → 미적용', () => {
    const tiers = [makeTier({ min_rental_amount: 200000, condition_types: ['long_term_rental'], discount_rate: 1 })]
    // 대여상품 금액만 50000, 총액은 250000이라도 호출부가 otRentalOnlySubtotal=50000을 전달
    const items = [makeDiscountItem({ rentalDays: 5, saleOnlyPurchase: false })]
    expect(calcShippingDiscountRate(tiers, 50000, items)).toBe(0)
  })

  it('[EC-1] 장기대여 단독 티어 — 대여상품 금액(otRentalOnlySubtotal)이 임계값 이상이면 → 매칭', () => {
    const tiers = [makeTier({ min_rental_amount: 50000, condition_types: ['long_term_rental'], discount_rate: 1 })]
    const items = [makeDiscountItem({ rentalDays: 5, saleOnlyPurchase: false })]
    expect(calcShippingDiscountRate(tiers, 50000, items)).toBe(1)
  })

  // EC-2: rental_item AND sale_only_purchase 조합
  it('[EC-2] 대여상품+판매상품 AND 조합 — 각각 1개씩 존재하면 매칭', () => {
    const tiers = [makeTier({ min_rental_amount: 0, condition_types: ['rental_item', 'sale_only_purchase'], discount_rate: 1 })]
    const items = [makeDiscountItem({ saleOnlyPurchase: false }), makeDiscountItem({ saleOnlyPurchase: true })]
    expect(calcShippingDiscountRate(tiers, 0, items)).toBe(1)
  })

  it('[EC-2] 대여상품+판매상품 AND 조합 — 대여상품만 있고 판매상품 없으면 미적용', () => {
    const tiers = [makeTier({ min_rental_amount: 0, condition_types: ['rental_item', 'sale_only_purchase'], discount_rate: 1 })]
    const items = [makeDiscountItem({ saleOnlyPurchase: false })]
    expect(calcShippingDiscountRate(tiers, 0, items)).toBe(0)
  })

  it('[EC-2] 대여상품+판매상품 AND 조합 — 판매상품만 있고 대여상품 없으면 미적용', () => {
    const tiers = [makeTier({ min_rental_amount: 0, condition_types: ['rental_item', 'sale_only_purchase'], discount_rate: 1 })]
    const items = [makeDiscountItem({ saleOnlyPurchase: true })]
    expect(calcShippingDiscountRate(tiers, 0, items)).toBe(0)
  })

  // EC-3: 전부 판매전용상품 — rental_item 조건 미적용, sale_only_purchase 조건만 매칭 가능
  it('[EC-3] 전부 판매전용상품 — rental_item 조건 미적용', () => {
    const tiers = [makeTier({ min_rental_amount: 0, condition_types: ['rental_item'], discount_rate: 1 })]
    const items = [makeDiscountItem({ saleOnlyPurchase: true }), makeDiscountItem({ saleOnlyPurchase: true })]
    expect(calcShippingDiscountRate(tiers, 0, items)).toBe(0)
  })

  it('[EC-3] 전부 판매전용상품 — sale_only_purchase 조건 단독 티어는 여전히 매칭 가능', () => {
    const tiers = [
      makeTier({ min_rental_amount: 0, condition_types: ['rental_item'], discount_rate: 1 }),
      makeTier({ min_rental_amount: 0, condition_types: ['sale_only_purchase'], discount_rate: 0.5 }),
    ]
    const items = [makeDiscountItem({ saleOnlyPurchase: true })]
    expect(calcShippingDiscountRate(tiers, 0, items)).toBe(0.5)
  })

  // EC-4: 빈 카트 — 기존 가드(items.length === 0 → 0) 유지
  it('[EC-4] 빈 카트 — 0 (기존 가드 유지)', () => {
    const tiers = [makeTier({ min_rental_amount: 0, condition_types: ['rental_item'], discount_rate: 1 })]
    expect(calcShippingDiscountRate(tiers, 0, [])).toBe(0)
  })

  // rental_item 조건과 long_term_rental 동시 AND 조합
  it('[rental_item+long_term_rental AND] 대여상품 중 3일이상 항목 있으면 매칭', () => {
    const tiers = [makeTier({ min_rental_amount: 0, condition_types: ['rental_item', 'long_term_rental'], discount_rate: 1 })]
    const items = [makeDiscountItem({ rentalDays: 5, saleOnlyPurchase: false })]
    expect(calcShippingDiscountRate(tiers, 0, items)).toBe(1)
  })

  it('[rental_item+long_term_rental AND] 대여상품이 있어도 3일 미만이면 미적용', () => {
    const tiers = [makeTier({ min_rental_amount: 0, condition_types: ['rental_item', 'long_term_rental'], discount_rate: 1 })]
    const items = [makeDiscountItem({ rentalDays: 2, saleOnlyPurchase: false })]
    expect(calcShippingDiscountRate(tiers, 0, items)).toBe(0)
  })
})

// isFreeDeliveryCouponBlocked — 배송료 우대설정 적용 중 free_delivery 쿠폰 상호배타 가드
// (Stephen 확정, 2026-09-01)
describe('isFreeDeliveryCouponBlocked', () => {
  it('배송료 우대설정 적용 중(rate>0) + free_delivery 쿠폰 → 차단(true)', () => {
    expect(isFreeDeliveryCouponBlocked('free_delivery', 1)).toBe(true)
    expect(isFreeDeliveryCouponBlocked('free_delivery', 0.5)).toBe(true)
  })

  it('배송료 우대설정 미적용(rate=0) → free_delivery 쿠폰이어도 차단 안 함(false)', () => {
    expect(isFreeDeliveryCouponBlocked('free_delivery', 0)).toBe(false)
  })

  it('free_delivery가 아닌 다른 쿠폰 타입 → 우대설정 적용 여부와 무관하게 차단 안 함(false)', () => {
    expect(isFreeDeliveryCouponBlocked('all', 1)).toBe(false)
    expect(isFreeDeliveryCouponBlocked('first_purchase', 1)).toBe(false)
  })

  it('타입이 null/undefined → 차단 안 함(false, 방어적 처리)', () => {
    expect(isFreeDeliveryCouponBlocked(null, 1)).toBe(false)
    expect(isFreeDeliveryCouponBlocked(undefined, 1)).toBe(false)
  })
})

// computeReturnVisibleTabs — "배송 반납 허용 지정" 판정을 is_bulk_delivery("요청 A" 전용)와
// 완전히 분리된 is_delivery_type 단독 기준으로 수행(Stephen 확정, 2026-09-04, Migration
// #440·#441·#443). 별도 마스터 on/off 토글 없음 — is_delivery_type=true인 방식이 있다는 사실
// 자체가 곧 활성화 조건(Stephen UX 지적으로 마스터 토글 완전 제거, 같은 세션 후속).
describe('computeReturnVisibleTabs', () => {
  type Tab = { v: string; label: string }
  const tabs: Tab[] = [
    { v: 'visit', label: '방문대여' },
    { v: 'quick', label: '퀵배송 대여' },
    { v: 'crazydelivery', label: '크레이지샷배송 대여' },
  ]
  // is_bulk_delivery만 true(is_delivery_type은 false) — "요청 A" 전용으로만 쓰이는 방식,
  // 반납선택제한 판정에서는 배송으로 취급되면 안 됨을 검증하기 위한 대조군
  const methods: DeliveryTypeMethod[] = [
    { method_key: 'visit', is_delivery_type: false },
    { method_key: 'quick', is_delivery_type: false },
    { method_key: 'crazydelivery', is_delivery_type: true },
  ]

  it('아무 방식도 is_delivery_type=true가 아니면 수령방식과 무관하게 항상 전체 목록 반환(자연 no-op)', () => {
    const noneMarked: DeliveryTypeMethod[] = [
      { method_key: 'visit', is_delivery_type: false },
      { method_key: 'quick', is_delivery_type: false },
      { method_key: 'crazydelivery', is_delivery_type: false },
    ]
    expect(computeReturnVisibleTabs(tabs, noneMarked, 'visit')).toEqual(tabs)
    expect(computeReturnVisibleTabs(tabs, noneMarked, 'quick')).toEqual(tabs)
  })

  it('수령=방문(배송 아님) → 배송(is_delivery_type=true)으로 지정된 방식만 제외', () => {
    const result = computeReturnVisibleTabs(tabs, methods, 'visit')
    expect(result.map((t) => t.v)).toEqual(['visit', 'quick'])
  })

  it('수령=퀵서비스(배송 아님) → 동일하게 배송 방식 제외 (Stephen 신고 시나리오 2 — 방문 아닌 다른 비배송 방식도 커버)', () => {
    const result = computeReturnVisibleTabs(tabs, methods, 'quick')
    expect(result.map((t) => t.v)).toEqual(['visit', 'quick'])
  })

  it('수령=배송(crazydelivery) → 요청 A가 반납을 이미 잠그므로 전체 목록 그대로 반환', () => {
    const result = computeReturnVisibleTabs(tabs, methods, 'crazydelivery')
    expect(result).toEqual(tabs)
  })

  it('is_bulk_delivery만 true인 방식(is_delivery_type=false)은 배송으로 취급되지 않는다 — is_bulk_delivery와 완전히 무관한 판정임을 증명', () => {
    // "요청 A" 전용으로 등록된 방식이 있어도(예: 실무에서 다른 방식에 is_bulk_delivery=true가
    // 설정돼 있는 상황을 가정), is_delivery_type이 false면 반납 탭에서 제외되지 않아야 한다.
    const methodsWithSeparateBulk: DeliveryTypeMethod[] = [
      { method_key: 'visit', is_delivery_type: false },
      { method_key: 'quick', is_delivery_type: false },
      { method_key: 'crazydelivery', is_delivery_type: false }, // is_bulk_delivery=true였어도 무관
    ]
    const result = computeReturnVisibleTabs(tabs, methodsWithSeparateBulk, 'visit')
    expect(result).toEqual(tabs) // 배송으로 판정된 방식이 없으므로 아무것도 제외 안 됨
  })

  it('빈 methods 배열 → 아무 방식도 배송으로 판정 안 되어 항상 전체 목록', () => {
    expect(computeReturnVisibleTabs(tabs, [], 'visit')).toEqual(tabs)
  })
})
