import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isContractIssueBlockedByApproval } from '$lib/server/contractApprovalGuard'

/**
 * 예약승인 전 신청대기 예약의 전자계약 생성·발송 서버 차단 (2026-10-15, Stephen 확정)
 *  막는 경우: hold + 승인 시각 없음 + 같은 주문에 승인된 형제·발송된 계약서 없음
 *  허용하는 경우: hold가 아님 / 승인됨 / 형제 승인 / 이미 발송된 계약서 / 컬럼 없는 환경(조회 오류)
 */
interface World {
  res: { status: string | null; approved_at: string | null } | null
  resError: { message: string } | null
  orderId: number | null
  siblings: number[]
  approvedSiblings: number
  sentContracts: number
}
let w: World
function admin() {
  return {
    from: (table: string) => {
      const q: Record<string, unknown> = {}
      let selected = ''
      Object.assign(q, {
        select: (c: string) => { selected = c; return q },
        eq: () => q, in: () => q, is: () => q, not: () => q,
        limit: async () => {
          if (table === 'rental_reservations') return { data: Array.from({ length: w.approvedSiblings }, (_, i) => ({ id: i })), error: null }
          if (table === 'contracts') return { data: Array.from({ length: w.sentContracts }, (_, i) => ({ id: String(i) })), error: null }
          return { data: [], error: null }
        },
        maybeSingle: async () => {
          if (table === 'rental_reservations') return { data: w.res, error: w.resError }
          if (table === 'order_items' && selected === 'order_id') return { data: w.orderId == null ? null : { order_id: w.orderId }, error: null }
          return { data: null, error: null }
        },
        then: (res: (v: unknown) => unknown) => res({ data: table === 'order_items' ? w.siblings.map((id) => ({ reservation_id: id })) : [], error: null }),
      })
      return q
    },
  } as never
}
function set(p: Partial<World>) {
  w = { res: { status: 'hold', approved_at: null }, resError: null, orderId: null, siblings: [], approvedSiblings: 0, sentContracts: 0, ...p }
}

describe('isContractIssueBlockedByApproval', () => {
  it('신청대기 + 승인 전 + 발송된 계약서 없음 → 차단', async () => {
    set({})
    expect(await isContractIssueBlockedByApproval(admin(), 1)).toBe(true)
  })
  it('예약승인된 신청대기 → 허용', async () => {
    set({ res: { status: 'hold', approved_at: '2026-10-15T00:00:00Z' } })
    expect(await isContractIssueBlockedByApproval(admin(), 1)).toBe(false)
  })
  it('신청대기가 아닌 예약(확정 이후 재발송 등)은 영향 없음', async () => {
    set({ res: { status: 'confirmed', approved_at: null } })
    expect(await isContractIssueBlockedByApproval(admin(), 1)).toBe(false)
  })
  it('같은 주문의 형제 예약이 승인됐으면 허용', async () => {
    set({ orderId: 9, siblings: [1, 2], approvedSiblings: 1 })
    expect(await isContractIssueBlockedByApproval(admin(), 1)).toBe(false)
  })
  it('이미 발송된 계약서가 있는 주문(승인 기능 도입 전 건)은 허용', async () => {
    set({ sentContracts: 1 })
    expect(await isContractIssueBlockedByApproval(admin(), 1)).toBe(false)
  })
  it('승인 시각 컬럼이 없는 환경(조회 오류)은 차단하지 않는다 — 배포 순서 사고 방지', async () => {
    set({ res: null, resError: { message: 'column rental_reservations.approved_at does not exist' } })
    expect(await isContractIssueBlockedByApproval(admin(), 1)).toBe(false)
  })
})

describe('서버 집행 배선(소스 확인)', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')
  it('init-contract는 계약서를 만들기 전에 승인 가드를 호출한다', () => {
    const s = read('src/routes/api/cms/reservations/[id]/init-contract/+server.ts')
    expect(s).toContain('isContractIssueBlockedByApproval(admin, reservationId)')
    expect(s.indexOf('isContractIssueBlockedByApproval(admin')).toBeLessThan(s.indexOf(".from('contracts')"))
  })
  it('send-chat은 서명 링크를 만들기 전에 승인 가드를 호출한다', () => {
    const s = read('src/routes/api/cms/contracts/[id]/send-chat/+server.ts')
    expect(s).toContain('isContractIssueBlockedByApproval(admin, contract.reservation_id)')
    expect(s.indexOf('isContractIssueBlockedByApproval(admin')).toBeLessThan(s.indexOf(".from('contract_signings')"))
  })
  it('예약승인 액션은 자동발행을 호출하기 전에 승인 시각을 기록한다(자동발행이 가드에 걸리지 않게)', () => {
    const s = read('src/routes/cms/reservation/+page.server.ts')
    const a = s.slice(s.indexOf('approveReservation: async'), s.indexOf('changeReservation: async'))
    expect(a.indexOf("approved_at: new Date().toISOString()")).toBeGreaterThan(-1)
    expect(a.indexOf("approved_at: new Date().toISOString()")).toBeLessThan(a.indexOf('autoIssueContractOnApproval('))
  })
  it('서류 승인 후 자동발행은 승인 시각을 기록한 뒤 발행한다', () => {
    const s = read('src/lib/server/autoIssueOnDocApproval.ts')
    expect(s.indexOf('approved_at: new Date().toISOString()')).toBeLessThan(s.indexOf('autoIssueContractOnApproval(deps'))
  })
  it('customer-docs는 승인 시각 컬럼이 없는 환경을 approvalTracking=false로 알리고, 화면은 그때 잠그지 않는다', () => {
    const api = read('src/routes/api/cms/reservations/[id]/customer-docs/+server.ts')
    expect(api).toContain('approvalTracking = false')
    const panel = read('src/lib/components/cms/RentalDetailPanel.svelte')
    expect(panel).toContain('customerDocs.approvalTracking !== false')
  })
  it("계약대기 칩에서 발송 전 행은 '승인완료 · 계약 미발송' 배지를 보여 준다", () => {
    const s = read('src/routes/cms/rentals/+page.svelte') // 통합 화면(2026-10-22)
    expect(s).toContain('승인완료 · 계약 미발송')
    expect(s).toMatch(/row\.status === 'hold' && !row\.signing_sent_at && data\.contractPending/)
  })
})
