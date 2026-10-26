/**
 * 마이페이지 대여 목록 — 같은 주문(order)의 예약 행을 카드 1장으로 묶는다 (2026-10-26).
 *
 * 정책: 장바구니에서 여러 상품을 한 번에 신청하면 하나의 예약코드·하나의 주문이다(service-operations §4).
 * 예약 행은 상품(재고 단위)마다 따로 있지만 고객에게는 대여 카드 1장 안에 상품 목록으로 보여준다.
 * 주문에 속하지 않은 예약은 자기 자신이 카드 1장. 같은 주문의 행은 항상 같은 단계로 함께 움직이므로(신청·계약·취소),
 * 카드의 취소·취소요청 표시는 주문 전체에 적용한다.
 */

export interface GroupableRental {
  id: string
  status: string
  start_date: string | null
  end_date: string | null
  product_name: string | null
  product_category: string | null
  has_signed_contract: boolean
  pending_contract_token: string | null
  returnSubmittable: boolean
  returnSubmitted: boolean
  cancelling: boolean
  cancelRequested?: boolean
}

export interface RentalGroupItem {
  id: string
  name: string | null
  category: string | null
}

export type Grouped<T extends GroupableRental> = T & {
  /** 카드에 나열할 상품 목록(주문에 묶인 모든 예약 행, 예약 id 오름차순) */
  items: RentalGroupItem[]
  /** 반납정보 등록 화면을 열 대상 예약 id — 아직 제출 안 한 첫 상품(없으면 대표 행) */
  returnTargetId: string
}

// 덜 진행된 단계일수록 앞 — 주문 상태 = 가장 덜 진행된 상품의 상태(CMS 목록과 동일 원칙)
const STATUS_RANK: Record<string, number> = {
  hold: 0, confirmed: 1, shipped: 2, in_use: 3, return_requested: 4, returned: 5, completed: 6,
}
const rankOf = (status: string): number => STATUS_RANK[status] ?? 99

function idNum(id: string): number {
  const n = Number(id)
  return Number.isFinite(n) ? n : 0
}

/**
 * @param rentals 목록 순서(최근 신청 순)를 유지한 예약 행들
 * @param orderIdByReservationId 예약 id(문자열) → 주문 id. 없으면 단독 카드
 */
export function groupRentalsByOrder<T extends GroupableRental>(
  rentals: T[],
  orderIdByReservationId: Map<string, number>,
): Array<Grouped<T>> {
  const buckets = new Map<string, T[]>()
  const order: string[] = []
  for (const r of rentals) {
    const oid = orderIdByReservationId.get(String(r.id))
    const key = oid != null ? `o:${oid}` : `r:${r.id}`
    if (!buckets.has(key)) { buckets.set(key, []); order.push(key) }
    buckets.get(key)?.push(r)
  }

  const out: Array<Grouped<T>> = []
  for (const key of order) {
    const members = [...(buckets.get(key) ?? [])].sort((a, b) => idNum(a.id) - idNum(b.id))
    // 대표 행 = 가장 덜 진행된 단계 중 예약 id가 가장 작은 행
    const rep = members.reduce((best, m) => (rankOf(m.status) < rankOf(best.status) ? m : best), members[0])
    const starts = members.map(m => m.start_date).filter((d): d is string => !!d).sort()
    const ends = members.map(m => m.end_date).filter((d): d is string => !!d).sort()
    const needSubmit = members.find(m => m.returnSubmittable && !m.returnSubmitted)
    out.push({
      ...rep,
      start_date: starts[0] ?? rep.start_date,
      end_date: ends[ends.length - 1] ?? rep.end_date,
      has_signed_contract: members.some(m => m.has_signed_contract),
      pending_contract_token: members.find(m => m.pending_contract_token)?.pending_contract_token ?? null,
      returnSubmittable: members.some(m => m.returnSubmittable),
      returnSubmitted: members.filter(m => m.returnSubmittable).every(m => m.returnSubmitted)
        && members.some(m => m.returnSubmittable),
      // 주문은 하나의 단위 — 한 행이라도 취소중/취소 요청 접수면 카드 전체가 그 상태
      cancelling: members.some(m => m.cancelling),
      cancelRequested: members.some(m => m.cancelRequested),
      items: members.map(m => ({ id: m.id, name: m.product_name, category: m.product_category })),
      returnTargetId: (needSubmit ?? rep).id,
    })
  }
  return out
}
