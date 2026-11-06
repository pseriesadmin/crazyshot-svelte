// 연체료 고객 알림 공용 함수 (2026-11-02, Stephen 지시)
//  · notifyLateFeePaid      — 결제 완료: 채팅 대화카드 + 푸시 + 문자. 고객 결제(pay-mock)와 관리자 [결제 확인]이 같이 쓴다.
//  · notifyLateFeeRequested — 결제 요청: 푸시 + 문자. 요청 대화카드는 DB 함수 auto_detect_late_fees 가 이미 만들므로 여기서 만들지 않는다
//                              (순수 SQL(pg_cron)에서는 푸시·문자를 보낼 수 없어 크론 /api/cron/late-fee-notice 가 이 함수를 호출한다).
// 모든 단계는 fail-soft — 한 채널이 실패해도 나머지 채널과 호출 흐름은 계속된다.

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendCardSms, sendPushToUser } from '$lib/server/push'

export interface LateFeeNoticeInput {
  lateFeeId: string
  reservationId: number
  feeAmount: number
  /** 이미 알고 있는 고객 id(고객 본인 결제 경로). 없으면 예약에서 조회한다. */
  userId?: string
}

function formatWon(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`
}

async function reservationUserId(admin: SupabaseClient, reservationId: number): Promise<string | null> {
  try {
    const { data } = await admin.from('rental_reservations').select('user_id').eq('id', reservationId).maybeSingle()
    return (data as { user_id?: string | null } | null)?.user_id ?? null
  } catch {
    return null
  }
}

/** 결제 완료 — 채팅 대화카드 + 푸시 + 문자 */
export async function notifyLateFeePaid(admin: SupabaseClient, input: LateFeeNoticeInput): Promise<void> {
  const userId = input.userId ?? (await reservationUserId(admin, input.reservationId))
  if (!userId) return
  const amountText = formatWon(input.feeAmount)

  // ① 채팅 대화카드 — 세션 조회는 공유 RPC 경유(service-operations.md §11)
  try {
    const { data: sessionId, error } = await admin.rpc('find_or_create_general_chat_session', {
      p_user_id: userId,
      p_reservation_id: input.reservationId,
    })
    if (error) {
      console.error('[late-fee/notify] 채팅 세션 조회 실패(fail-soft):', error.message)
    } else if (sessionId) {
      const { error: insertError } = await admin.from('chat_messages').insert({
        session_id: sessionId,
        sender_type: 'admin',
        message_type: 'action_card',
        content: `연체료 결제가 완료됐습니다. (${amountText})`,
        action_payload: {
          type: 'late_fee_paid',
          late_fee_id: input.lateFeeId,
          reservation_id: String(input.reservationId),
          fee_amount: input.feeAmount,
          button_label: '대여 정보 확인',
          action_url: '/account/rental',
        },
        is_read: false,
      })
      if (insertError) console.error('[late-fee/notify] 결제 완료 카드 저장 실패(fail-soft):', insertError.message)
    }
  } catch (err) {
    console.error('[late-fee/notify] 결제 완료 카드 발송 예외(fail-soft):', err instanceof Error ? err.message : err)
  }

  // ② 푸시
  try {
    await sendPushToUser(
      userId,
      'late_fee_paid',
      { title: '연체료 결제가 완료됐어요', body: `연체료 ${amountText} 결제가 정상 처리됐어요.`, link: '/account/rental' },
      { vars: { 연체료: amountText } },
    )
  } catch (err) {
    console.error('[late-fee/notify] 결제 완료 푸시 실패(fail-soft):', err instanceof Error ? err.message : err)
  }

  // ③ 문자
  try {
    await sendCardSms(admin, { userId, reservationId: input.reservationId, notifyType: 'late_fee_paid', vars: { 연체료: amountText } })
  } catch (err) {
    console.error('[late-fee/notify] 결제 완료 문자 실패(fail-soft):', err instanceof Error ? err.message : err)
  }
}

/**
 * 결제 요청 — 푸시 + 문자(대화카드는 DB 함수가 이미 생성)
 * 반환: 푸시가 전달됐거나 문자가 나갔으면(또는 오늘 이미 나갔으면) true. 고객을 못 찾았거나 두 채널 모두 실패하면 false —
 * 크론이 false 를 받으면 선점을 되돌려 다음 날 다시 시도한다(2026-11-03, sp3 MAJOR: 전면 fail-soft 로 되돌림이 도달 불가였던 결함 수정).
 */
export async function notifyLateFeeRequested(admin: SupabaseClient, input: LateFeeNoticeInput): Promise<boolean> {
  const userId = input.userId ?? (await reservationUserId(admin, input.reservationId))
  if (!userId) return false
  const amountText = formatWon(input.feeAmount)
  const payLink = `/pay/late-fee/${input.lateFeeId}`

  let pushDelivered = false
  try {
    const result = await sendPushToUser(
      userId,
      'late_fee_request',
      { title: '연체료 결제 요청이 도착했어요', body: `연체료 ${amountText} 결제를 요청드려요. 대여 정보에서 확인해 주세요.`, link: payLink },
      { vars: { 연체료: amountText } },
    )
    pushDelivered = result?.delivered === true
  } catch (err) {
    console.error('[late-fee/notify] 결제 요청 푸시 실패(fail-soft):', err instanceof Error ? err.message : err)
  }

  let smsSent = false
  try {
    smsSent = await sendCardSms(admin, { userId, reservationId: input.reservationId, notifyType: 'late_fee_request', link: payLink, vars: { 연체료: amountText } })
  } catch (err) {
    console.error('[late-fee/notify] 결제 요청 문자 실패(fail-soft):', err instanceof Error ? err.message : err)
  }

  return pushDelivered || smsSent
}
