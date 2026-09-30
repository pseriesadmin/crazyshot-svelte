/**
 * 무료배송 쿠폰 "할인값" 규약.
 * free_shipping의 discount_value는 "배송비에서 차감할 금액 상한"이다(장바구니: min(값, 배송비)).
 * DB 제약(coupons_discount_value_check: discount_value > 0) 때문에 0/빈 값을 저장할 수 없으므로,
 * 운영자가 값을 비우면 "배송비 전액 면제"를 뜻하는 충분히 큰 상한값을 채워 저장한다.
 */
export const FREE_SHIPPING_FULL_WAIVER = 9_999_999

/** free_shipping이고 값이 비어 있거나 0 이하면 전액 면제 상한값으로 정규화한다(그 외 유형은 그대로). */
export function normalizeFreeShippingValue(discountType: string, value: number): number {
  if (discountType === 'free_shipping' && !(Number.isFinite(value) && value > 0)) return FREE_SHIPPING_FULL_WAIVER
  return value
}

/** 전액 면제 상한값 여부 — 화면에서 금액 대신 "전액 면제"로 보여줄 때 사용. */
export function isFullShippingWaiver(value: number): boolean {
  return value >= FREE_SHIPPING_FULL_WAIVER
}
