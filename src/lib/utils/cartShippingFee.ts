// src/lib/utils/cartShippingFee.ts
// 배송비(왕복/배송/반납요금) — 카트 전체 기준 3단계 중 딱 1개만 최대 1회 부과
// (2026-08-30 Stephen 확정 — 아래 3-way 배타 규칙으로 재설계, 과거 "왕복+반납 독립 가산"
// 모델을 대체):
//   ① 수령·반납 둘 다 배송   → 왕복요금(round_trip_fee) 1회만
//   ② 수령만 배송(반납은 아님) → 배송요금(delivery_fee) 1회만
//   ③ 반납만 배송(수령은 아님) → 반납요금(return_fee) 1회만
//   그 외(둘 다 배송 아님)     → 0
// 세 조건은 상호 배타적이라 스태킹되지 않는다 — 항상 최대 1개 요금만 반환.
//
// 기존 rental_method_options.fee_amount(방식별 고정요금)는 CMS 입력 UI 자체가 없어
// 항상 0으로 방치된 죽은 필드였음이 감사(RSC-C3)로 확인돼 완전히 제거됨 — 이 3개 요금이
// 배송비의 유일한 산정 근거다.
//
// 순수 함수 — DB 접근 없음. 호출부(cart/+page.svelte)가 shippingSettings와 체크된
// 아이템 목록(각 아이템의 배송 여부·상품별 플래그)을 조립해 전달한다.

export interface ShippingSettings {
  enable_round_trip: boolean
  round_trip_fee: number | null
  enable_delivery: boolean
  delivery_fee: number | null
  enable_return: boolean
  return_fee: number | null
}

export interface ShippingFeeItem {
  pickupIsDelivery: boolean
  returnIsDelivery: boolean
  shipping_round_trip?: boolean | null
  shipping_delivery?: boolean | null
  shipping_return?: boolean | null
}

/**
 * 배송비 — 체크된 아이템 전체 기준으로 수령·반납 배송 여부 조합에 따라 왕복/배송/반납요금
 * 중 정확히 하나만(또는 0) 반환한다. 상품별 플래그(shipping_round_trip/delivery/return)가
 * 해당 티어 대상 아이템 중 하나라도 false면 그 티어는 전체 미적용(보수적 처리).
 */
export function calcShippingFee(settings: ShippingSettings | null, items: ShippingFeeItem[]): number {
  if (!settings || items.length === 0) return 0

  const anyPickupDelivery = items.some((it) => it.pickupIsDelivery)
  const anyReturnDelivery = items.some((it) => it.returnIsDelivery)

  if (anyPickupDelivery && anyReturnDelivery) {
    if (!settings.enable_round_trip) return 0
    const allFlagged = items.every((it) => it.shipping_round_trip !== false)
    return allFlagged ? (settings.round_trip_fee ?? 0) : 0
  }

  if (anyPickupDelivery && !anyReturnDelivery) {
    if (!settings.enable_delivery) return 0
    const allFlagged = items.every((it) => it.shipping_delivery !== false)
    return allFlagged ? (settings.delivery_fee ?? 0) : 0
  }

  if (!anyPickupDelivery && anyReturnDelivery) {
    if (!settings.enable_return) return 0
    const allFlagged = items.every((it) => it.shipping_return !== false)
    return allFlagged ? (settings.return_fee ?? 0) : 0
  }

  return 0
}

// 배송료 우대설정 — CMS에서 등록한 "대여금액 임계값 + 조건" 조합(최대 5개)이 만족되면
// 배송비(왕복+배송+반납 합계)에 할인율을 적용한다(Stephen 확정, 2026-08-29).
//
// 확정된 판정 규칙:
//   - 대여금액 기준: 장바구니 전체 대여금액 합계(otSubtotal) >= min_rental_amount
//   - 조건 판정 범위(조건 종류별): 체크된 카트 항목 중 하나라도(OR) 그 조건을 만족하면 충족
//   - 한 조합에 조건을 여러 개 선택한 경우: 선택된 조건 전부가 AND로 결합돼야 그 조합이
//     매칭된다(예: 장기대여+판매상품구매를 동시에 선택 → 카트에 3일이상 대여 항목이 있고
//     "동시에" 판매상품 구매 항목도 있어야 함 — 반드시 같은 항목일 필요는 없음. Stephen 확정,
//     2026-08-29 — 최초 단일선택 설계를 다중선택+AND로 개정)
//   - 다중 매칭: 다수 조합이 동시에 만족되면 가장 유리한(할인율 큰) 조합 1개만 적용(스태킹 없음)

export interface DeliveryFeeDiscountTier {
  min_rental_amount: number
  condition_types: Array<'long_term_rental' | 'sale_only_purchase'>
  discount_rate: number // 0 | 0.5 | 1
}

export interface DiscountConditionItem {
  rentalDays: number
  saleOnlyPurchase: boolean
}

/**
 * otSubtotal 기준 임계값을 충족하고, 그 조합에 선택된 조건 전부(AND)가 체크된 아이템 중
 * 최소 1개씩으로 만족되는 조합들 중 가장 유리한(할인율 최대) 단일 할인율을 반환한다.
 * 매칭되는 조합이 없으면 0.
 */
export function calcShippingDiscountRate(
  tiers: DeliveryFeeDiscountTier[],
  otSubtotal: number,
  items: DiscountConditionItem[],
): number {
  if (!tiers.length || items.length === 0) return 0

  const anyLongTerm = items.some((it) => it.rentalDays >= 3)
  const anySaleOnly = items.some((it) => it.saleOnlyPurchase)
  const conditionSatisfied: Record<'long_term_rental' | 'sale_only_purchase', boolean> = {
    long_term_rental: anyLongTerm,
    sale_only_purchase: anySaleOnly,
  }

  let best = 0
  for (const tier of tiers) {
    if (otSubtotal < tier.min_rental_amount) continue
    if (!tier.condition_types.length) continue
    const conditionMet = tier.condition_types.every((ct) => conditionSatisfied[ct])
    if (conditionMet && tier.discount_rate > best) best = tier.discount_rate
  }
  return best
}
