/**
 * contractApprovalGuard.ts — 예약승인 전 신청대기 예약의 전자계약 생성·발송 차단 (2026-10-15, Stephen 확정)
 *
 * 화면은 예약승인 전 계약서 탭의 발행·발송 버튼을 잠그지만, 화면 제어만으로는 API 직접 호출을 막지 못한다 — 서버에서도 같은 규칙을 집행한다.
 * 막는 경우 = 예약이 신청대기(hold)이고 · 예약승인 시각(approved_at, Migration #719)이 없고 · 이 주문에 이미 발송된 계약서도 없을 때.
 * 허용하는 경우:
 *   · 신청대기가 아닌 예약(확정 이후 재발송 등 기존 동작 유지)
 *   · 예약승인된 예약(승인 시각 있음) — 자동발행 경로도 승인 시각을 먼저 기록한 뒤 호출한다(approveReservation·autoIssueAfterDocApproval)
 *   · 이미 계약서가 발송된 주문(승인 기능 도입 전 건의 재발송·조회)
 *   · 승인 시각 컬럼이 없는 환경(마이그레이션 미적용) — 조회 오류는 차단하지 않는다(fail-open, 배포 순서 사고로 계약서를 못 보내는 일 방지)
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const CONTRACT_APPROVAL_REQUIRED_MESSAGE = '예약승인 후에 전자계약을 발행·발송할 수 있어요. 먼저 예약목록에서 예약승인을 실행해 주세요.'

export async function isContractIssueBlockedByApproval(admin: SupabaseClient, reservationId: number): Promise<boolean> {
  try {
    const { data: res, error } = await admin
      .from('rental_reservations')
      .select('status, approved_at')
      .eq('id', reservationId)
      .maybeSingle()
    if (error || !res) return false // 컬럼 없음·조회 실패 → 차단하지 않는다
    const row = res as { status: string | null; approved_at: string | null }
    if (row.status !== 'hold') return false
    if (row.approved_at) return false

    // 같은 주문의 다른 상품이 승인됐거나 이미 발송된 계약서가 있으면 허용(주문당 계약서 1건)
    const ids = [reservationId]
    const { data: own } = await admin.from('order_items').select('order_id').eq('reservation_id', reservationId).maybeSingle()
    const orderId = (own as { order_id: number | null } | null)?.order_id
    if (orderId != null) {
      const { data: sibs } = await admin.from('order_items').select('reservation_id').eq('order_id', orderId)
      for (const s of (sibs ?? []) as Array<{ reservation_id: number | null }>) {
        if (s.reservation_id != null && !ids.includes(s.reservation_id)) ids.push(s.reservation_id)
      }
      const { data: approvedSib } = await admin
        .from('rental_reservations').select('id').in('id', ids).not('approved_at', 'is', null).limit(1)
      if ((approvedSib?.length ?? 0) > 0) return false
    }
    const { data: sent } = await admin
      .from('contracts')
      .select('id, contract_signings!inner(sent_at)')
      .in('reservation_id', ids)
      .is('deleted_at', null)
      .not('contract_signings.sent_at', 'is', null)
      .limit(1)
    if ((sent?.length ?? 0) > 0) return false
    return true
  } catch {
    return false
  }
}
