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
