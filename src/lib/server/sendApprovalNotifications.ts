import type { SupabaseClient } from '@supabase/supabase-js'
import { sendReservationLifecyclePush } from '$lib/server/push'
import { scheduleArchiveNow } from '$lib/server/contractArchive/archiveNow'
import type { ApprovalNotifyPlan } from '$lib/server/reservationApprovalNotify'

/**
 * 예약 승인 알림(채팅카드 + 고객 푸시)을 한 번에 처리하는 공용 헬퍼.
 *
 * mode='hold' 시 즉시 반환해 채팅과 푸시를 동시에 보류한다.
 * "채팅 판정이 보류(hold)인데 푸시만 별도로 나가는" 상황을 구조적으로 방지한다
 * (service-operations.md §4, §15, 항목2 NTF-C2/NTF-C3 수정 근거).
 *
 * 5개 발신지점 전부 이 함수를 경유 — GATE B Q1 확정:
 *   - cms/reservation/+page.server.ts  approveReservation
 *   - api/contracts/[token]/pay-mock/+server.ts
 *   - contract/[token]/pay-result/+page.server.ts
 *   - api/contracts/[token]/sign/+server.ts
 *   - (payment/success — 구코드, 파일 없음, Q2 설명 범위만 포함)
 */
export async function sendApprovalNotifications(
  admin: SupabaseClient,
  reservationId: number,
  notifyPlan: ApprovalNotifyPlan,
): Promise<void> {
  // §4 보류(hold) — 같은 주문의 다른 상품이 아직 미승인 → 채팅·푸시 둘 다 보류
  if (notifyPlan.mode === 'hold') return

  // 채팅카드 발송 (batch: 통합 1건 / single: 단건)
  if (notifyPlan.mode === 'batch') {
    await admin.rpc('send_rental_chat_notification_batch', {
      p_reservation_ids: notifyPlan.reservationIds,
      p_notify_type:     'reservation_approval',
    })
  } else {
    // mode === 'single'
    await admin.rpc('send_rental_chat_notification', {
      p_reservation_id: reservationId,
      p_notify_type:    'reservation_approval',
    })
  }

  // 고객 푸시 — 채팅카드가 실제로 발송된 경우(not hold)에만 § 15 동기화 원칙 준수
  await sendReservationLifecyclePush(admin, reservationId, 'reservation_approval')

  // 서명+결제가 모두 끝난(승인 확정) 직후 최종본 PDF 즉시 생성(2026-10-08, Stephen 지시) — 서명 API 직후 호출이 실패·누락됐어도 여기서 다시 요청한다.
  // 이미 보관된 건은 멱등이라 중복 생성되지 않고, 실패해도 흐름에 영향이 없다(10분 크론이 처리).
  scheduleArchiveNow(reservationId)
}
