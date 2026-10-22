import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'

vi.mock('$lib/server/awardOnTimeReturnPoints', () => ({ awardOnTimeReturnPoints: vi.fn(async () => undefined) }))
import { ensureReturnedForInspection } from '$lib/server/inspection'

function fake(statusById: Record<number, string>, orderId: number | null, siblings: number[]) {
  const rpcCalls: { id: number; to: string }[] = []
  const client = {
    from(table: string) {
      const q: Record<string, unknown> = {}
      let filterId: number | null = null
      let inIds: number[] | null = null
      Object.assign(q, {
        select: () => q,
        eq: (col: string, v: unknown) => { if (col === 'id' || col === 'reservation_id') filterId = Number(v); return q },
        in: (_c: string, v: number[]) => { inIds = v; return q },
        maybeSingle: async () => {
          if (table === 'rental_reservations') return { data: filterId != null && statusById[filterId] ? { status: statusById[filterId] } : null }
          if (table === 'order_items') return { data: orderId != null ? { order_id: orderId } : null }
          return { data: null }
        },
        then: (resolve: (v: unknown) => void) => {
          if (table === 'order_items') return resolve({ data: siblings.map((reservation_id) => ({ reservation_id })) })
          if (table === 'rental_reservations') return resolve({ data: (inIds ?? []).filter((i) => statusById[i] === 'return_requested').map((id) => ({ id })) })
          return resolve({ data: [] })
        },
      })
      return q
    },
    rpc: async (_n: string, a: { p_reservation_id: number; p_new_status: string }) => {
      rpcCalls.push({ id: a.p_reservation_id, to: a.p_new_status })
      return { data: { ok: true }, error: null }
    },
  }
  return { client: client as never, rpcCalls }
}

describe('ensureReturnedForInspection — 회수 확인 전 검수', () => {
  it('반납요청 건과 같은 주문의 반납요청 형제를 반납완료로 전환한다', async () => {
    const f = fake({ 1: 'return_requested', 2: 'return_requested', 3: 'in_use' }, 10, [1, 2, 3])
    expect((await ensureReturnedForInspection(f.client, 1)).ok).toBe(true)
    expect(f.rpcCalls.map((c) => c.id).sort()).toEqual([1, 2])
    expect(f.rpcCalls.every((c) => c.to === 'returned')).toBe(true)
  })
  it('이미 반납완료이면 아무 전환도 하지 않는다', async () => {
    const f = fake({ 1: 'returned' }, null, [])
    expect((await ensureReturnedForInspection(f.client, 1)).ok).toBe(true)
    expect(f.rpcCalls.length).toBe(0)
  })
  it('예약이 없으면 실패한다', async () => {
    expect((await ensureReturnedForInspection(fake({}, null, []).client, 9)).ok).toBe(false)
  })
})

describe('파손 신고·대여 종료 알림 흐름 — 소스 점검', () => {
  const panel = readFileSync('src/lib/components/cms/RentalDetailPanel.svelte', 'utf-8')
  const rentals = readFileSync('src/routes/cms/rentals/+page.server.ts', 'utf-8')
  it('하단 액션바에 파손 신고 접수 버튼이 없다(검수 탭 이슈 등록으로 통합)', () => {
    expect(panel).not.toContain('파손 신고 접수 처리</button>')
    expect(panel).not.toContain("action: 'damage'")
  })
  it("'대여 종료 알림'은 검수 승인(approveInspection)으로 완료 처리한다", () => {
    expect(rentals).toContain("notifyType === 'rental_complete'")
    expect(rentals).toContain('approveInspection(admin, reservationId')
  })
})
