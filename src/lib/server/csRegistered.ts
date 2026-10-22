// CS 접수가 등록된 예약 판별 — 완료(completed)로 바뀌면 대여현황 '취소·환불·CS' 칩으로 분류한다(2026-10-22, Stephen 확정).
// CS 접수 = 사전 접수(has_prior_issue) · 검수 이슈 기록(reservation_inspection_issues) · 이슈 해소로 마감(inspection_status='resolved').
// 목록은 "주문 1건 = 1행"이므로 같은 주문의 형제 예약 id까지 모아 대표 행이 어느 쪽이든 같은 칩으로 분류한다.
// 조회 실패는 빈 집합(= 기존 '완료' 칩 그대로)으로 처리한다(fail-soft).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

export async function loadCsReservationIds(admin: AnyClient): Promise<Set<number>> {
  const base = new Set<number>()
  try {
    const [prior, resolved, issues] = await Promise.all([
      admin.from('rental_reservations').select('id').eq('has_prior_issue', true).limit(2000),
      admin.from('rental_reservations').select('id').eq('inspection_status', 'resolved').limit(2000),
      admin.from('reservation_inspection_issues').select('reservation_id').limit(5000),
    ])
    for (const r of (prior.data ?? []) as { id: number }[]) base.add(r.id)
    for (const r of (resolved.data ?? []) as { id: number }[]) base.add(r.id)
    for (const r of (issues.data ?? []) as { reservation_id: number }[]) base.add(r.reservation_id)
    if (base.size === 0) return base

    const ids = [...base]
    const { data: own } = await admin.from('order_items').select('order_id').in('reservation_id', ids)
    const orderIds = [...new Set(((own ?? []) as { order_id: number | null }[]).map((r) => r.order_id).filter((v): v is number => v != null))]
    if (orderIds.length > 0) {
      const { data: sibs } = await admin.from('order_items').select('reservation_id').in('order_id', orderIds)
      for (const r of (sibs ?? []) as { reservation_id: number | null }[]) if (r.reservation_id != null) base.add(r.reservation_id)
    }
    return base
  } catch {
    return new Set<number>()
  }
}
