/**
 * '반납중' 칩 행에 반납 진행 단계 배지를 붙인다 (2026-10-19).
 *  · registered  = 고객이 반납 이력정보(사진·체크리스트·무인함 정보)를 등록함 (reservation_return_submissions 있음)
 *  · notice_sent = 반납요청 알림이 발송됨 (return_notice_logs 있음, 아직 등록 전)
 *  · notice_due  = 반납 예정일이 도래했으나 알림 발송 전(발송 예정)
 * 목록은 주문 1건 = 대표 예약 1행이므로 대표 예약 기준으로 판정한다. 조회 실패는 배지 없이 진행(fail-soft).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type ReturnStage = 'notice_due' | 'notice_sent' | 'registered'

export const RETURN_STAGE_RANK: Record<ReturnStage, number> = { notice_due: 0, notice_sent: 1, registered: 2 }

export async function attachReturnStage<T extends { reservation_id: number; status: string; return_stage?: ReturnStage }>(
  admin: SupabaseClient,
  rows: T[],
): Promise<void> {
  const targets = rows.filter((r) => r.status === 'in_use' || r.status === 'return_requested' || r.status === 'returned')
  if (targets.length === 0) return
  const ids = targets.map((r) => r.reservation_id)

  const [subs, logs] = await Promise.all([
    admin.from('reservation_return_submissions').select('reservation_id').in('reservation_id', ids),
    admin.from('return_notice_logs').select('reservation_id').in('reservation_id', ids),
  ])
  if (subs.error || logs.error) {
    console.error('[attachReturnStage] 조회 실패:', subs.error?.message ?? logs.error?.message)
    return
  }
  const subSet = new Set(((subs.data ?? []) as { reservation_id: number }[]).map((r) => r.reservation_id))
  const logSet = new Set(((logs.data ?? []) as { reservation_id: number }[]).map((r) => r.reservation_id))

  for (const r of targets) {
    if (subSet.has(r.reservation_id)) r.return_stage = 'registered'
    else if (r.status === 'in_use') r.return_stage = logSet.has(r.reservation_id) ? 'notice_sent' : 'notice_due'
    else if (logSet.has(r.reservation_id)) r.return_stage = 'notice_sent'
  }
}
