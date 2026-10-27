// src/lib/server/trackingApplicability.ts
// 운송장 정보(택배사·운송장 번호) 입력 대상 판정 — 수령방식이 배송형(rental_method_options.is_delivery_type)인 예약만 (2026-10-27, Stephen 지시)
//
// 방문·무인보관함·퀵서비스에는 운송장이 없다. 번호를 넣으면 고객에게 "운송장 번호가 등록되었습니다" 안내가 나가고(tracking_notify),
// 운송장이 있는 예약을 보는 두발히어로 취소·상태 동기화 경로로 흘러갈 수 있다. 정책상 수령이 배송이 아니면 반납도 배송이 될 수 없어(배송 반납 허용 지정)
// 수령방식 하나만 보면 된다.
//
// 반환: true=입력 대상(배송형) / false=대상 아님(비배송형·수령방식 없음) / null=알 수 없음(예약·방식 행 없음·조회 오류) — 호출부는 null 을 fail-open(기존 동작 유지)으로 다룬다.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = { from: (table: string) => any }

export async function getTrackingApplicability(admin: AnySupabaseClient, reservationId: number): Promise<boolean | null> {
  try {
    const { data: reservation, error: rErr } = await admin
      .from('rental_reservations')
      .select('pickup_method')
      .eq('id', reservationId)
      .maybeSingle()
    if (rErr || !reservation) return null

    const methodKey = (reservation as { pickup_method: string | null }).pickup_method
    if (!methodKey) return false

    const { data: method, error: mErr } = await admin
      .from('rental_method_options')
      .select('is_delivery_type')
      .eq('method_key', methodKey)
      .is('deleted_at', null)
      .maybeSingle()
    if (mErr || !method) return null
    return (method as { is_delivery_type: boolean }).is_delivery_type === true
  } catch {
    return null
  }
}
