// 무인보관함 이용안내 — 무인함 [배정 확정] 저장 즉시 푸시+문자 사전 고지 (2026-11-12, Stephen 확정, Migration #820)
//  · 푸시알림 설정에 등록한 안내문장(100자 이내)만 그 예약 고객에게 보낸다. 번호·비밀번호는 넣지 않는다(수령 1시간 전 '수령이용 안내'가 따로 보낸다).
//  · 예약당 1회 — 발송 시각을 먼저 선점(rental_reservations.locker_assign_notice_sent_at)하고, 이후 번호·비밀번호를 고쳐 저장해도 다시 보내지 않는다.
//  · 등록한 문장이 없거나 이 알림을 끈 상태(설정 행 push_enabled=false)면 보내지 않고 선점도 하지 않는다 — 문장을 등록·켠 뒤 다음 배정부터 나간다.
//  · 취소·만료된 예약은 보내지 않는다. 모두 fail-soft: 어떤 오류도 배정 저장을 막지 않는다.
import type { SupabaseClient } from '@supabase/supabase-js'
import { getNotifyMessageOverride } from '$lib/server/notifyMessages'
import { sendReservationLifecyclePush } from '$lib/server/push'

export const LOCKER_ASSIGN_NOTICE_TYPE = 'locker_assign_notice'

export type LockerAssignNoticeResult = { sent: boolean; reason: 'sent' | 'no_message' | 'disabled' | 'already_sent' | 'inactive' | 'error' }

export async function sendLockerAssignNotice(admin: SupabaseClient, reservationId: number): Promise<LockerAssignNoticeResult> {
  try {
    const message = await getNotifyMessageOverride(admin, LOCKER_ASSIGN_NOTICE_TYPE)
    if (!message) return { sent: false, reason: 'no_message' }

    const { data: cfg } = await admin.from('push_notification_config').select('push_enabled').eq('notify_type', LOCKER_ASSIGN_NOTICE_TYPE).maybeSingle()
    if ((cfg as { push_enabled?: boolean } | null)?.push_enabled === false) return { sent: false, reason: 'disabled' }

    // 선점: 아직 안 보낸 살아 있는 예약만 한 번에 표시한다(동시에 두 번 눌러도 한 번만 나간다)
    const { data: claimed, error: claimErr } = await admin
      .from('rental_reservations')
      .update({ locker_assign_notice_sent_at: new Date().toISOString() })
      .eq('id', reservationId)
      .is('locker_assign_notice_sent_at', null)
      .not('status', 'in', '(cancelled,expired)')
      .select('id')
    if (claimErr) {
      console.warn('[lockerAssignNotice] 선점 실패:', reservationId, claimErr.message)
      return { sent: false, reason: 'error' }
    }
    if (!claimed || claimed.length === 0) {
      return { sent: false, reason: 'already_sent' } // 이미 보냈거나 취소·만료
    }

    await sendReservationLifecyclePush(admin, reservationId, LOCKER_ASSIGN_NOTICE_TYPE)
    return { sent: true, reason: 'sent' }
  } catch (e) {
    console.warn('[lockerAssignNotice] 오류:', reservationId, e instanceof Error ? e.message : e)
    return { sent: false, reason: 'error' }
  }
}
