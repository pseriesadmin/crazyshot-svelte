// 두발히어로 배송 접수로 운송장 번호가 저장된 직후 고객에게 "운송장 등록" 안내(채팅카드 + 푸시 + 문자)를 보낸다 (2026-10-27)
//
// 배경: tracking_notify 는 CMS 운송장 수동 저장(PATCH tracking)에서만 나갔다. 두발히어로 접수는 번호를 DB 에만 저장해
// 고객은 번호가 담긴 안내를 받지 못했다(반출 알림은 접수보다 먼저 나가 그 시점엔 번호가 없다).
// 접수 호출부(상태 전환 shipped · CMS 두발히어로 접수 버튼)가 저장 성공 직후 주문당 1회 호출한다. 실패해도 throw 하지 않는다(fail-soft).
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendReservationLifecyclePush } from '$lib/server/push'

export async function notifyTrackingRegistered(admin: SupabaseClient, reservationId: number): Promise<void> {
  try {
    const { error } = await admin.rpc('send_rental_chat_notification', { p_reservation_id: reservationId, p_notify_type: 'tracking_notify' })
    if (error) console.error(`[tracking-registered/chat] fail-soft [${reservationId}]:`, error.message)
  } catch (e) {
    console.error(`[tracking-registered/chat] fail-soft [${reservationId}]:`, e instanceof Error ? e.message : e)
  }
  try {
    await sendReservationLifecyclePush(admin, reservationId, 'tracking_notify')
  } catch (e) {
    console.error(`[tracking-registered/push] fail-soft [${reservationId}]:`, e instanceof Error ? e.message : e)
  }
}
