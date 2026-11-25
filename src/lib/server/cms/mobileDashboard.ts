/**
 * 모바일 현장앱 대시보드 건수 — 선택한 날짜(KST 기준 날짜) 기준 (2026-11-25)
 *  · 신청대기·계약완료·반출중·대여중·반납중 = 대여 기간(시작일~종료일)이 그 날짜를 포함하는 예약을 '현재 상태'별로 센다.
 *  · 신규 = 그 날짜에 '계약완료' 상태가 된 주문(상태 전환 시각이 그날 0시~24시, KST).
 *  주문 1건 = 1개(같은 예약코드는 합산). 조회 실패 시 모두 0 — 대시보드만 비고 화면은 유지한다.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadReservationChipCounts } from '$lib/server/cms/reservationStageList'

export interface MobileDashboardCounts {
  hold: number
  confirmed: number
  shipped: number
  inUse: number
  returning: number
  fresh: number
}

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 한국 시각 기준 오늘 날짜(YYYY-MM-DD) */
export function todayKst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export async function loadMobileDashboardCounts(admin: SupabaseClient, date: string): Promise<MobileDashboardCounts> {
  const empty: MobileDashboardCounts = { hold: 0, confirmed: 0, shipped: 0, inUse: 0, returning: 0, fresh: 0 }
  if (!ISO_DATE_RE.test(date)) return empty
  const key = (r: { id: number; reservation_code: string | null }): string => r.reservation_code ?? `id:${r.id}`

  const { data, error } = await admin
    .from('rental_reservations')
    .select('id, reservation_code, status')
    .in('status', ['hold', 'confirmed', 'shipped', 'in_use', 'return_requested', 'returned'])
    .lte('start_date', date)
    .gte('end_date', date)
    .limit(5000)
  if (error) {
    console.error('[mobileDashboard] 단계별 건수 조회 실패:', error.message)
    return empty
  }
  const buckets: Record<string, Set<string>> = { hold: new Set(), confirmed: new Set(), shipped: new Set(), in_use: new Set(), returning: new Set() }
  for (const r of (data ?? []) as Array<{ id: number; reservation_code: string | null; status: string }>) {
    const b = r.status === 'return_requested' || r.status === 'returned' ? 'returning' : r.status
    buckets[b]?.add(key(r))
  }

  const { data: fresh, error: fErr } = await admin
    .from('rental_reservations')
    .select('id, reservation_code')
    .eq('status', 'confirmed')
    .gte('status_changed_at', `${date}T00:00:00+09:00`)
    .lt('status_changed_at', `${nextDay(date)}T00:00:00+09:00`)
    .limit(2000)
  if (fErr) console.error('[mobileDashboard] 신규 건수 조회 실패:', fErr.message)
  const freshKeys = new Set(((fresh ?? []) as Array<{ id: number; reservation_code: string | null }>).map(key))

  return {
    hold: buckets.hold.size,
    confirmed: buckets.confirmed.size,
    shipped: buckets.shipped.size,
    inUse: buckets.in_use.size,
    returning: buckets.returning.size,
    fresh: freshKeys.size,
  }
}

// ── 첫 화면 기본값: 날짜를 고르지 않았을 때는 '현재까지' 진행 중인 모든 주문을 통합해서 센다(대여현황 칩과 같은 기준, 주문 1건 = 1개).
//    신규 = 오늘(KST) 계약완료가 된 주문.
const LIFECYCLE = ['confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed', 'damage_claimed']

export async function loadMobileTotalCounts(admin: SupabaseClient): Promise<MobileDashboardCounts> {
  const countOf = async (args: Record<string, unknown>): Promise<number> => {
    const { data, error } = await admin.rpc('get_rental_list', {
      p_search: null, p_date_from: null, p_date_to: null, p_page: 1, p_per_page: 1, p_group_by_order: true, ...args,
    })
    if (error) { console.error('[mobileDashboard] 통합 건수 조회 실패:', error.message); return 0 }
    return ((data ?? []) as Array<{ total_count?: number }>)[0]?.total_count ?? 0
  }
  const today = todayKst()
  const [chip, confirmed, shipped, inUse, returning, todayCounts] = await Promise.all([
    loadReservationChipCounts(admin),
    countOf({ p_status: 'confirmed', p_include_statuses: LIFECYCLE }),
    countOf({ p_status: 'shipped', p_include_statuses: LIFECYCLE }),
    countOf({ p_status: 'in_use', p_inspection_scope: 'in_use_pending', p_include_statuses: LIFECYCLE }),
    countOf({ p_status: null, p_inspection_scope: 'returning', p_include_statuses: ['in_use', 'return_requested', 'returned'] }),
    loadMobileDashboardCounts(admin, today),
  ])
  return { hold: chip.hold ?? 0, confirmed, shipped, inUse, returning, fresh: todayCounts.fresh }
}
