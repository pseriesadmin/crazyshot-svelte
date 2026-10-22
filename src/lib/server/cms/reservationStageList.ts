// 통합 예약·대여현황(/cms/rentals, 2026-10-22 — 예약현황·대여현황 통합)의 "예약 단계" 칩 조회 — 임시예약·신청대기·계약대기.
// 기존 /cms/reservation 로더의 조회 규칙을 그대로 옮겼다(같은 get_rental_list 인자). 라이프사이클 칩(계약완료~완료)은 rentals 로더가 직접 조회한다.
import type { SupabaseClient } from '@supabase/supabase-js'
import { escapeLikePattern } from '$lib/server/escapeLikePattern'
import type { RentalListRow } from '../../../routes/cms/reservation/+page.server'

export interface ReservationStageQuery {
  /** 'draft'(임시예약) | 'hold'(신청대기 / contractPending=true 면 계약대기) */
  status: 'draft' | 'hold'
  contractPending: boolean
  search: string
  dateFrom: string
  dateTo: string
  page: number
  selectedId: number | null
}

const LIFECYCLE_STATUSES = ['confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed', 'damage_claimed']

export async function loadReservationStageRows(
  admin: SupabaseClient,
  q: ReservationStageQuery,
): Promise<{ rentals: RentalListRow[]; totalCount: number }> {
  const isDraftTab = q.status === 'draft'
  // 임시예약 칩에서만 '임시-292'·'292' 형태 검색을 임시예약 id 조회로 처리한다(임시예약은 예약코드가 없다)
  const draftIdMatch = isDraftTab ? q.search.trim().match(/^(?:임시-?)?(\d{1,15})$/) : null
  const draftIdSearch = draftIdMatch ? Number(draftIdMatch[1]) : null
  const isReservationPendingTab = q.status === 'hold' && !q.contractPending

  const { data: rows, error } = await admin.rpc('get_rental_list', {
    p_status:                          q.status,
    p_search:                          draftIdSearch != null ? null : (escapeLikePattern(q.search) || null),
    p_reservation_id:                  draftIdSearch,
    p_date_from:                       q.dateFrom || null,
    p_date_to:                         q.dateTo || null,
    p_page:                            q.page,
    p_per_page:                        30,
    p_include_statuses:                null,
    p_exclude_statuses:                [...LIFECYCLE_STATUSES, ...(isDraftTab ? [] : ['draft'])],
    p_require_contract_sent_unsigned:  q.contractPending || null,
    p_exclude_contract_sent:           isReservationPendingTab || null,
    p_group_by_order:                  true,
  })
  if (error) console.error('[cms/rentals] 예약 단계 목록 조회 실패:', error.message)

  const rentals: RentalListRow[] = (rows ?? []) as RentalListRow[]
  // 총 건수는 링크 예약 행을 앞에 붙이기 "전" 원 목록 기준으로 확정(붙인 행의 total_count는 항상 1)
  const totalCount = rentals[0]?.total_count ?? 0

  // 계약대기 칩 — 방금 계약서를 발송한 예약이 다음 페이지에 있어도 패널이 열려 있게 그 행만 따로 붙인다
  if (q.contractPending && q.selectedId != null && !rentals.some((r) => r.reservation_id === q.selectedId)) {
    const { data: selOne, error: selErr } = await admin.rpc('get_rental_list', {
      p_status: null, p_search: null, p_date_from: null, p_date_to: null,
      p_page: 1, p_per_page: 1, p_include_statuses: ['hold'], p_reservation_id: q.selectedId,
      p_group_by_order: true,
    })
    if (selErr) console.error('[cms/rentals] 계약대기 링크 예약 조회 실패:', selErr.message)
    const one = ((selOne ?? []) as RentalListRow[])[0]
    if (one) rentals.unshift(one)
  }
  return { rentals, totalCount }
}

/** 예약 단계 칩 건수(임시예약·신청대기·계약대기) — 주문 1건=1행 기준, 검색·기간 필터와 무관한 전체 건수. 실패하면 null(배지 없음). */
export async function loadReservationChipCounts(
  admin: SupabaseClient,
): Promise<{ draft: number | null; hold: number | null; contract_pending: number | null }> {
  const holdCountOf = async (pending: boolean): Promise<number | null> => {
    const { data, error } = await admin.rpc('get_rental_list', {
      p_status: 'hold', p_search: null, p_date_from: null, p_date_to: null, p_page: 1, p_per_page: 1,
      p_exclude_statuses: [...LIFECYCLE_STATUSES, 'draft'],
      p_require_contract_sent_unsigned: pending || null,
      p_exclude_contract_sent: !pending || null,
      p_group_by_order: true,
    })
    if (error) { console.error('[cms/rentals] 칩 건수 조회 실패:', error.message); return null }
    return ((data ?? []) as RentalListRow[])[0]?.total_count ?? 0
  }
  const draftCount = async (): Promise<number | null> => {
    const { data, error } = await admin.rpc('get_rental_list', {
      p_status: 'draft', p_search: null, p_date_from: null, p_date_to: null, p_page: 1, p_per_page: 1,
      p_exclude_statuses: LIFECYCLE_STATUSES,
      p_group_by_order: true,
    })
    if (error) { console.error('[cms/rentals] 임시예약 칩 건수 조회 실패:', error.message); return null }
    return ((data ?? []) as RentalListRow[])[0]?.total_count ?? 0
  }
  const [hold, contract_pending, draft] = await Promise.all([holdCountOf(false), holdCountOf(true), draftCount()])
  return { draft, hold, contract_pending }
}
