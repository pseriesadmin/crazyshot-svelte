// src/lib/utils/cartShippingFee.ts
// 왕복요금/반납요금 — 카트 전체 기준 최대 1회 부과 (TASK.md Q5, 2026-08-25 Stephen 확정)
//
// 기존 rental_method_options.fee_amount(방식별 고정요금, 상품·예약마다 개별 부과)와는
// 별개의 항목이다 — 이 두 함수는 그 위에 "가산"되며 대체하지 않는다(핵심제약).
//
// 순수 함수 — DB 접근 없음. 호출부(cart/+page.svelte)가 shippingSettings와 체크된
// 아이템 목록(각 아이템의 배송 여부·상품별 플래그)을 조립해 전달한다.

export interface ShippingSettings {
  enable_round_trip: boolean
  round_trip_fee: number | null
  enable_return: boolean
  return_fee: number | null
}

export interface ShippingFeeItem {
  pickupIsDelivery: boolean
  returnIsDelivery: boolean
  shipping_round_trip?: boolean | null
  shipping_return?: boolean | null
}

/**
 * 왕복요금 — 체크된 아이템 중 하나라도 수령방식이 배송이면 1회 부과.
 * 상품별 shipping_round_trip 플래그가 하나라도 false면 전체 미적용(보수적 처리, 부분적용 없음).
 */
export function calcRoundTripFee(settings: ShippingSettings | null, items: ShippingFeeItem[]): number {
  if (!settings || !settings.enable_round_trip) return 0
  if (items.length === 0) return 0

  const anyPickupDelivery = items.some((it) => it.pickupIsDelivery)
  if (!anyPickupDelivery) return 0

  const allFlagged = items.every((it) => it.shipping_round_trip !== false)
  if (!allFlagged) return 0

  return settings.round_trip_fee ?? 0
}

/**
 * 반납요금 — 체크된 아이템 중 하나라도 반납방식이 배송이면 1회 부과.
 * 상품별 shipping_return 플래그가 하나라도 false면 전체 미적용(보수적 처리, 부분적용 없음).
 * calcRoundTripFee와 완전히 독립적으로 판정된다(수령·반납 둘 다 배송이면 두 함수 모두 값을 반환).
 */
export function calcReturnFee(settings: ShippingSettings | null, items: ShippingFeeItem[]): number {
  if (!settings || !settings.enable_return) return 0
  if (items.length === 0) return 0

  const anyReturnDelivery = items.some((it) => it.returnIsDelivery)
  if (!anyReturnDelivery) return 0

  const allFlagged = items.every((it) => it.shipping_return !== false)
  if (!allFlagged) return 0

  return settings.return_fee ?? 0
}

// 배송료 우대설정 — CMS에서 등록한 "대여금액 임계값 + 조건" 조합(최대 3개)이 만족되면
// 배송비(왕복+배송+반납 합계)에 할인율을 적용한다(Stephen 확정, 2026-08-29).
//
// 확정된 판정 규칙:
//   - 대여금액 기준: 장바구니 전체 대여금액 합계(otSubtotal) >= min_rental_amount
//   - 조건 판정 범위: 체크된 카트 항목 중 하나라도(OR) 조건을 만족하면 매칭
//   - 다중 매칭: 다수 조합이 동시에 만족되면 가장 유리한(할인율 큰) 조합 1개만 적용(스태킹 없음)

export interface DeliveryFeeDiscountTier {
  min_rental_amount: number
  condition_type: 'long_term_rental' | 'sale_only_purchase'
  discount_rate: number // 0 | 0.5 | 1
}

export interface DiscountConditionItem {
  rentalDays: number
  saleOnlyPurchase: boolean
}

/**
 * otSubtotal 기준 임계값을 충족하고, 체크된 아이템 중 최소 1개가 그 조합의 조건을 만족하는
 * 조합들 중 가장 유리한(할인율 최대) 단일 할인율을 반환한다. 매칭되는 조합이 없으면 0.
 */
export function calcShippingDiscountRate(
  tiers: DeliveryFeeDiscountTier[],
  otSubtotal: number,
  items: DiscountConditionItem[],
): number {
  if (!tiers.length || items.length === 0) return 0

  const anyLongTerm = items.some((it) => it.rentalDays >= 3)
  const anySaleOnly = items.some((it) => it.saleOnlyPurchase)

  let best = 0
  for (const tier of tiers) {
    if (otSubtotal < tier.min_rental_amount) continue
    const conditionMet =
      (tier.condition_type === 'long_term_rental' && anyLongTerm) ||
      (tier.condition_type === 'sale_only_purchase' && anySaleOnly)
    if (conditionMet && tier.discount_rate > best) best = tier.discount_rate
  }
  return best
}
