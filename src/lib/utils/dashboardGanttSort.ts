// 홈 '예약승인 및 대여 일정' 행 정렬 — '예약대여현황 탭별 정렬·필터 정리 v1'(2026-11-20) 홈 항목.
// 1) 상태 우선순위: 신청대기 → 연체·지연 → 당일 출고·수령 예정 → 당일 반납 예정(대여중·반납중) → 검수대기 → (그 밖의 진행 중) → 완료·반납완료·만료·취소
// 2) 같은 예약코드의 상품·고객은 붙여서 정렬(같은 코드의 행 중 가장 앞선 우선순위를 그 묶음의 순위로 쓴다)
// 3) 같은 순위 안에서는 신청일 최신순(기본) / 오래된 순, 묶음 안에서는 상품명 순
// 연체 판정은 간트 화면의 기존 규칙(반납 기한 경과 + confirmed/shipped/in_use)에 수령 지연(대여 시작일 경과인데 아직 계약완료·반출중)을 더했다.
// ⚠ 의도적 차이: 간트 막대의 붉은 연체 표시(CmsDashboardGantt isOverdue)는 기존 규칙 그대로(수령 지연은 표시 안 함), 정렬만 수령 지연을 앞쪽에 둔다.
//   또 이 정렬은 날짜 단위(KST 아님·시각 미사용)라 대여현황 목록의 시각 단위 지연(DB private.rental_pickup_due·rental_return_due)과 당일 건 분류가 다를 수 있다 — 수령 지연을 막대에도 표시할지는 Stephen 확인 후 결정.

export interface GanttSortRow {
  reservation_id: number
  reservation_code: string | null
  status: string
  rental_start: string
  rental_end: string
  product_name: string
  created_at: string
}

export type GanttSortOrder = 'newest' | 'oldest'

const OVERDUE_STATUSES = new Set(['confirmed', 'shipped', 'in_use'])
const TERMINAL_STATUSES = new Set(['completed', 'damage_claimed', 'expired', 'cancelled'])

export const GANTT_RANK = {
  pending: 0,
  overdue: 1,
  todayPickup: 2,
  todayReturn: 3,
  inspection: 4,
  ongoing: 5,
  done: 6,
} as const

export function ganttPriority(row: GanttSortRow, todayStr: string): number {
  const s = row.status
  if (s === 'hold' || s === 'pending') return GANTT_RANK.pending
  if (TERMINAL_STATUSES.has(s)) return GANTT_RANK.done
  if (OVERDUE_STATUSES.has(s) && row.rental_end < todayStr) return GANTT_RANK.overdue
  if ((s === 'confirmed' || s === 'shipped') && row.rental_start < todayStr) return GANTT_RANK.overdue
  if ((s === 'confirmed' || s === 'shipped') && row.rental_start === todayStr) return GANTT_RANK.todayPickup
  if ((s === 'in_use' || s === 'return_requested') && row.rental_end === todayStr) return GANTT_RANK.todayReturn
  if (s === 'returned') return GANTT_RANK.inspection
  return GANTT_RANK.ongoing
}

export function sortGanttRows<T extends GanttSortRow>(rows: T[], todayStr: string, order: GanttSortOrder = 'newest'): T[] {
  const keyOf = (r: T) => r.reservation_code ?? `r${r.reservation_id}`
  const groupRank = new Map<string, number>()
  const groupCreated = new Map<string, string>()
  for (const r of rows) {
    const k = keyOf(r)
    const p = ganttPriority(r, todayStr)
    groupRank.set(k, Math.min(groupRank.get(k) ?? p, p))
    const cur = groupCreated.get(k)
    // 묶음의 신청일 = 가장 늦은 신청일(같은 주문이면 같은 값)
    if (cur == null || r.created_at > cur) groupCreated.set(k, r.created_at)
  }
  const dir = order === 'newest' ? -1 : 1
  return [...rows].sort((a, b) => {
    const ka = keyOf(a)
    const kb = keyOf(b)
    return (
      ((groupRank.get(ka) ?? 0) - (groupRank.get(kb) ?? 0)) ||
      dir * ((groupCreated.get(ka) ?? '').localeCompare(groupCreated.get(kb) ?? '')) ||
      ka.localeCompare(kb) ||
      a.product_name.localeCompare(b.product_name) ||
      a.rental_start.localeCompare(b.rental_start) ||
      a.reservation_id - b.reservation_id
    )
  })
}
