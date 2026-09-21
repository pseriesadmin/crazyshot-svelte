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

/**
 * 체크된 아이템 기준으로 지금 청구될 배송비가 "왕복"(수령·반납 둘 다 배송)인지 판정한다.
 * calcShippingFee() 내부의 왕복 판정과 완전히 동일한 조건(anyPickupDelivery && anyReturnDelivery)을
 * 재사용 — applyShippingDiscount()가 "50% 할인은 왕복요금에만 적용"을 판정할 때 쓴다.
 */
export function isRoundTripShippingFee(items: ShippingFeeItem[]): boolean {
  return items.some((it) => it.pickupIsDelivery) && items.some((it) => it.returnIsDelivery)
}

/**
 * 배송료 우대설정 할인율을 실제 배송비에 적용한다(Stephen 확정, 2026-09-15).
 *   - discount_rate=1(무료)  → 요금 종류(왕복/편도) 무관하게 항상 전액 적용
 *   - discount_rate<1(예: 50% 할인) → 왕복요금(isRoundTrip=true)일 때만 적용, 편도(배송·반납)
 *     요금에는 적용되지 않는다(그 경우 할인율을 0으로 취급 — 정가 그대로 청구)
 * discount_rate=0(기본왕복배송요금, 신규 등록은 비활성화됨)은 어느 경우든 결과가 0이라
 * 이 분기와 무관하게 항상 동일한 결과(전액 청구)를 낸다.
 */
export function applyShippingDiscount(
  shippingFee: number,
  discountRate: number,
  isRoundTrip: boolean,
): number {
  const effectiveRate = discountRate >= 1 ? discountRate : (isRoundTrip ? discountRate : 0)
  return Math.round(shippingFee * (1 - effectiveRate))
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
  condition_types: Array<'long_term_rental' | 'sale_only_purchase' | 'rental_item'>
  discount_rate: number // 0 | 0.5 | 1
}

export interface DiscountConditionItem {
  rentalDays: number
  saleOnlyPurchase: boolean
}

/**
 * 금액 임계값을 충족하고, 그 조합에 선택된 조건 전부(AND)가 체크된 아이템 중
 * 최소 1개씩으로 만족되는 조합들 중 가장 유리한(할인율 최대) 단일 할인율을 반환한다.
 * 매칭되는 조합이 없으면 0.
 *
 * 금액 인자(두 번째 파라미터)는 호출부가 otRentalOnlySubtotal(대여상품 전용 소계)을
 * 전달한다 — Q2=a(전면 교체, 2026-09-01 Stephen 확정): 모든 티어의 금액 비교 기준이
 * 대여상품만의 합계로 통일됨. otSubtotal(전체 합계) 대신 이 값을 쓰므로 기존 티어
 * (long_term_rental·sale_only_purchase 단독)도 대여상품 금액 기준으로 판정된다.
 *
 * ⚠️ 예외(2026-09-15 후속, Stephen 확정): 위 Q2=a는 "판매상품 구매(sale_only_purchase)가
 * 유일한 조건"인 티어에는 더 이상 적용하지 않는다 — 그런 티어는 대여상품을 전혀 담지 않고
 * 판매상품만 구매해도 조건("판매상품 구매") 자체는 충족되는데, 금액 문턱은 대여상품 소계만
 * 봐서 절대 만족될 수 없는 모순이 있었다(대여상품 없이 판매상품 50만원을 사도 0원 취급).
 * `saleOnlySubtotal`(네 번째 인자, 판매전용상품 구매액 합계)을 새로 받아 이 경우에만 기준을
 * 교체한다 — 그 외(long_term_rental·rental_item 단독, 또는 sale_only_purchase가 다른 조건과
 * 함께 선택된 조합)는 기존 그대로 대여상품 소계 기준을 유지한다. 기존 호출부(테스트 포함)와의
 * 하위호환을 위해 생략 시 rentalOnlySubtotal과 동일하게 기본값 처리한다.
 */
export function calcShippingDiscountRate(
  tiers: DeliveryFeeDiscountTier[],
  rentalOnlySubtotal: number,
  items: DiscountConditionItem[],
  saleOnlySubtotal: number = rentalOnlySubtotal,
): number {
  if (!tiers.length || items.length === 0) return 0

  const anyLongTerm = items.some((it) => it.rentalDays >= 3)
  const anySaleOnly = items.some((it) => it.saleOnlyPurchase)
  const anyRentalItem = items.some((it) => !it.saleOnlyPurchase)
  const conditionSatisfied: Record<'long_term_rental' | 'sale_only_purchase' | 'rental_item', boolean> = {
    long_term_rental: anyLongTerm,
    sale_only_purchase: anySaleOnly,
    rental_item: anyRentalItem,
  }

  let best = 0
  for (const tier of tiers) {
    if (!tier.condition_types.length) continue
    const isSaleOnlySoleCondition =
      tier.condition_types.length === 1 && tier.condition_types[0] === 'sale_only_purchase'
    const amountBasis = isSaleOnlySoleCondition ? saleOnlySubtotal : rentalOnlySubtotal
    if (amountBasis < tier.min_rental_amount) continue
    const conditionMet = tier.condition_types.every((ct) => conditionSatisfied[ct])
    if (conditionMet && tier.discount_rate > best) best = tier.discount_rate
  }
  return best
}

/**
 * 배송료 우대설정(calcShippingDiscountRate)이 이미 배송료를 할인/무료화한 카트에서
 * 배송비 할인 쿠폰(discount_type='free_shipping')을 중복 선택하지 못하도록 막는
 * 상호배타 가드 (Stephen 확정, 2026-09-01) — 사용자만 이중 혜택을 보는 결과를 방지.
 *
 * ⚠️ 2026-09-21 수정: 최초 구현 시 coupons.type(마케팅 분류, 'free_delivery')을 기준으로
 * 판단했으나, 실제 배송비 할인 계산은 coupons.discount_type(할인 방식, 'free_shipping')
 * 기준으로 동작한다(Migration 510/511) — 서로 다른 컬럼이라 type≠'free_delivery'이면서
 * discount_type='free_shipping'인 쿠폰은 이 가드를 우회할 수 있었다. 실제 계산 기준
 * 컬럼(discount_type)으로 통일.
 */
export function isFreeDeliveryCouponBlocked(
  couponDiscountType: string | null | undefined,
  shippingDiscountRate: number,
): boolean {
  return couponDiscountType === 'free_shipping' && shippingDiscountRate > 0
}

export interface DeliveryTypeMethod {
  method_key: string
  is_delivery_type: boolean
}

/**
 * "배송 반납 허용 지정"(rental_method_options.is_delivery_type) — 수령이 배송이 아닐 때만, ON으로
 * 지정된 방식을 반납 탭 목록에서 제외한다. (Stephen 확정, 2026-09-04 — Migration #440·#441·#443)
 *
 * ⛔ 별도 마스터 on/off 토글은 없다 — 원래 있던 rental_shipping_settings.restrict_return_delivery
 * 전역 토글은 UX 혼란(칩과 별개로 켜야 하는 스위치가 하나 더 있는 구조)을 이유로 완전히
 * 제거됨(Stephen 지시: "그냥 제거해"). is_delivery_type=true로 지정된 방식이 있으면 그 자체가
 * 곧 활성화 조건 — 아무 방식도 지정 안 하면 자연히 아무것도 제외되지 않는 no-op이 된다.
 *
 * is_bulk_delivery("요청 A" 전용, 완전히 별개 플래그)와는 무관하게 독립 판정한다 — 같은
 * 방식이 두 플래그를 동시에 가질 수 없다는 전제(RPC 상호배타 가드)는 이 함수 밖(DB 레벨)에서
 * 보장된다. 서버 최종방어선(set_reservation_shipment_method, Migration #443)도 동일 기준으로
 * 통일됨.
 */
export function computeReturnVisibleTabs<T extends { v: string }>(
  allTabs: T[],
  deliveryTypeMethods: DeliveryTypeMethod[],
  pickupMethodKey: string,
): T[] {
  const isDeliveryType = (k: string) => deliveryTypeMethods.some((m) => m.method_key === k && m.is_delivery_type)
  if (!isDeliveryType(pickupMethodKey)) {
    return allTabs.filter((tab) => !isDeliveryType(tab.v))
  }
  return allTabs
}
