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
  it("'검수' 탭에 수량 배지가 있고 종료 단계에서는 세지 않는다(승인·해소 전 등록 항목 합계)", () => {
    expect(panel).toContain('inspectionBadgeCount')
    expect(panel).toContain("tab.id === 'inspection' && inspectionBadgeCount > 0")
    expect(panel).toContain("['completed', 'cancelled', 'expired', 'damage_claimed', 'draft'].includes(row.status)")
  })
  it("'고객 반납정보 등록'은 상품별 아코디언이고 헤더에 상품 이름·품번을 보인다", () => {
    expect(panel).toContain('{#each evSubItems as it (it.rid)}')
    expect(panel).toContain('evSubOpen[it.rid] ?? evSubItems.length === 1')
    expect(panel).toContain('<span class="cs-title-code"> · {it.code}</span>')
    const api = readFileSync('src/routes/api/cms/reservations/[id]/return-evidence/+server.ts', 'utf-8')
    expect(api).toContain('product_code: codeById.get(sid) ?? null')
  })
  it("'검수' 칩 목록에서는 헤더 [반납 검수 승인]을 숨긴다([완료 처리(추가청구)]가 완료까지 처리)", () => {
    const page = readFileSync('src/routes/cms/rentals/+page.svelte', 'utf-8')
    expect(page).toContain("hideInspectionApprove={(data.status ?? '') === 'inspection'}")
    expect(panel).toContain('!hideInspectionApprove &&')
  })
  it("'대여 종료 알림' 수동 버튼은 제거됐고 서버도 완료 처리를 하지 않는다(완료는 검수 승인으로만)", () => {
    expect(panel).not.toContain("type: 'rental_complete'")
    expect(rentals).toContain("notifyType === 'rental_complete') return fail(400")
    expect(rentals).not.toContain('approveInspection(')
  })
})
