/**
 * 고객 취소 요청 대기("취소대기") 표식을 목록 행에 붙인다 (2026-10-09, Migration 687).
 * 대상: cancel_requested_at이 있고 아직 cancelled가 아닌 예약. 주문 1건 = 1행(대표 예약)이며
 * 요청 표식은 같은 주문의 계약완료 예약 전체에 기록되므로 대표 행 id로 조회해도 잡힌다.
 * 조회 실패는 표식 없이 진행(fail-soft — 목록 자체는 항상 보인다).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export async function attachCancelPending<T extends { reservation_id: number; cancel_pending?: boolean }>(
  admin: SupabaseClient,
  rows: T[],
): Promise<void> {
  const ids = rows.filter((r) => !r.cancel_pending).map((r) => r.reservation_id)
  if (ids.length === 0) return
  const { data, error } = await admin
    .from('rental_reservations')
    .select('id')
    .in('id', ids)
    .not('cancel_requested_at', 'is', null)
    .neq('status', 'cancelled')
  if (error) {
    console.error('[attachCancelPending] 조회 실패:', error.message)
    return
  }
  const pending = new Set(((data ?? []) as Array<{ id: number }>).map((r) => r.id))
  for (const r of rows) if (pending.has(r.reservation_id)) r.cancel_pending = true
}
