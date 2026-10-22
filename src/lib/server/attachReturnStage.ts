/**
 * '반납중' 칩 행에 반납 진행 단계 배지를 붙인다 (2026-10-19).
 *  · registered  = 고객이 반납 이력정보(사진·체크리스트·무인함 정보)를 등록함 (reservation_return_submissions 있음)
 *  · notice_sent = 반납요청 알림이 발송됨 (return_notice_logs 있음 또는 방문·미지정의 반납예정 카드 발송, 아직 등록 전) — 화면에는 배지를 달지 않는다(조용히 사라짐)
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

  // 방문·미지정 반납은 return_notice_logs 가 아니라 기존 09시 반납예정 크론(return_remind 채팅카드)이 안내하므로 그 카드의 링크로 발송 여부를 본다
  const remindUrlToId = new Map<string, number>()
  for (const r of targets) if (r.status === 'in_use') remindUrlToId.set(`/account/rental/${r.reservation_id}/history`, r.reservation_id)

  const [subs, logs, reminds] = await Promise.all([
    admin.from('reservation_return_submissions').select('reservation_id').in('reservation_id', ids),
    admin.from('return_notice_logs').select('reservation_id').in('reservation_id', ids),
    remindUrlToId.size > 0
      ? admin.from('chat_messages').select('action_payload').eq('action_payload->>type', 'return_remind').in('action_payload->>action_url', [...remindUrlToId.keys()])
      : Promise.resolve({ data: [], error: null }),
  ])
  if (subs.error || logs.error) {
    console.error('[attachReturnStage] 조회 실패:', subs.error?.message ?? logs.error?.message)
    return
  }
  const subSet = new Set(((subs.data ?? []) as { reservation_id: number }[]).map((r) => r.reservation_id))
  const logSet = new Set(((logs.data ?? []) as { reservation_id: number }[]).map((r) => r.reservation_id))
  // 반납예정 카드 조회 실패는 배지 판정만 보수적으로(예정 유지) 처리한다
  if (!reminds.error) {
    for (const m of (reminds.data ?? []) as { action_payload?: { action_url?: string } | null }[]) {
      const id = remindUrlToId.get(m.action_payload?.action_url ?? '')
      if (id != null) logSet.add(id)
    }
  }

  for (const r of targets) {
    if (subSet.has(r.reservation_id)) r.return_stage = 'registered'
    else if (r.status === 'in_use') r.return_stage = logSet.has(r.reservation_id) ? 'notice_sent' : 'notice_due'
    else if (logSet.has(r.reservation_id)) r.return_stage = 'notice_sent'
  }
}
