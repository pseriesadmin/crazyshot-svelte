// src/lib/server/dheroMemo.ts
// 두발히어로 배송 접수에 실을 고객 요청 메모 선택 (2026-10-27)
//
// 장바구니 '요청 사항'은 수령용(pickup_request_note)·반납용(return_request_note)으로 예약에 저장된다(Migration #476).
// 두발히어로 접수 memoFromCustomer 가 옛 notes 컬럼만 읽어 새 요청사항(공동현관 출입번호 등)이 전달되지 않던 문제를 바로잡는다.
// 100자 제한은 createDelivery(clipDheroMemo)가 집행한다.
// ⚠ 이 메모는 **운송장에 인쇄**된다. 공동현관 출입번호는 전용 칸(pickup_frontdoor_password → frontdoorPassword, 운송장 미인쇄, Migration #774)으로 분리했다 — 고객이 '요청 사항'에 직접 적은 번호는 여전히 인쇄될 수 있다(dhero-delivery-api.md §3).

export function pickDeliveryMemo(res: { pickupRequestNote?: string | null; notes?: string | null }): string | undefined {
  const t = (res.pickupRequestNote ?? '').trim() || (res.notes ?? '').trim()
  return t || undefined
}
