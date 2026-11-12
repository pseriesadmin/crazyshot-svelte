import { describe, it, expect, vi } from 'vitest'

vi.mock('$lib/server/awardOnTimeReturnPoints', () => ({ awardOnTimeReturnPoints: vi.fn(async () => undefined) }))
import { resolveApprovalTargetId } from '$lib/server/inspection'

interface Row { id: number; status: string; inspection_status?: string | null }

// 대표 예약(첫 id)이 이미 완료돼도 같은 주문의 검수 대기 형제를 승인 대상으로 고르는지 점검하는 가짜 DB
function fake(rows: Row[], orderId: number | null) {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const client = {
    from(table: string) {
      let filterId: number | null = null
      let inIds: number[] | null = null
      let inStatuses: string[] | null = null
      const q: Record<string, unknown> = {}
      Object.assign(q, {
        select: () => q,
        order: () => q,
        eq: (col: string, v: unknown) => { if (col === 'id' || col === 'reservation_id') filterId = Number(v); return q },
        in: (col: string, v: unknown[]) => { if (col === 'id') inIds = v as number[]; else inStatuses = v as string[]; return q },
        maybeSingle: async () => {
          if (table === 'rental_reservations') return { data: filterId != null && byId.get(filterId) ? { status: byId.get(filterId)!.status } : null }
          if (table === 'order_items') return { data: orderId != null ? { order_id: orderId } : null }
          return { data: null }
        },
        then: (resolve: (v: unknown) => void) => {
          if (table === 'order_items') return resolve({ data: rows.map((r) => ({ reservation_id: r.id })) })
          if (table === 'rental_reservations') {
            return resolve({ data: (inIds ?? []).map((i) => byId.get(i)).filter((r): r is Row => !!r && (!inStatuses || inStatuses.includes(r.status))) })
          }
          return resolve({ data: [] })
        },
      })
      return q
    },
  }
  return client as never
}

describe('resolveApprovalTargetId — 대표 예약이 이미 완료된 주문의 승인 대상', () => {
  it('대표가 완료이고 형제가 반납완료·검수 대기이면 가장 앞선 형제를 고른다', async () => {
    const c = fake([{ id: 392, status: 'completed', inspection_status: 'resolved' }, { id: 393, status: 'returned', inspection_status: 'pending' }, { id: 394, status: 'returned', inspection_status: 'pending' }], 119)
    expect(await resolveApprovalTargetId(c, 392)).toBe(393)
  })
  it('대표가 반납완료이면 대표를 그대로 쓴다', async () => {
    const c = fake([{ id: 1, status: 'returned', inspection_status: 'pending' }, { id: 2, status: 'returned', inspection_status: 'pending' }], 10)
    expect(await resolveApprovalTargetId(c, 1)).toBe(1)
  })
  it('대표가 반납요청이어도 대표를 그대로 쓴다(회수 확인 전 승인 흐름 유지)', async () => {
    const c = fake([{ id: 1, status: 'return_requested' }, { id: 2, status: 'returned', inspection_status: 'pending' }], 10)
    expect(await resolveApprovalTargetId(c, 1)).toBe(1)
  })
  it.each(['in_use', 'confirmed', 'cancelled', 'damage_claimed'])('대표가 %s이면 형제가 반납완료여도 대표를 그대로 돌려줘 DB가 거절하게 한다', async (st) => {
    const c = fake([{ id: 1, status: st }, { id: 2, status: 'returned', inspection_status: 'pending' }], 10)
    expect(await resolveApprovalTargetId(c, 1)).toBe(1)
  })
  it('이슈 검수중인 형제는 고르지 않는다 — 대상이 없으면 원래 예약을 돌려줘 DB가 사유를 거절한다', async () => {
    const c = fake([{ id: 1, status: 'completed' }, { id: 2, status: 'returned', inspection_status: 'issue' }], 10)
    expect(await resolveApprovalTargetId(c, 1)).toBe(1)
  })
  it('주문이 없는 단독 예약이면 그대로 돌려준다', async () => {
    expect(await resolveApprovalTargetId(fake([{ id: 5, status: 'completed' }], null), 5)).toBe(5)
  })
})
