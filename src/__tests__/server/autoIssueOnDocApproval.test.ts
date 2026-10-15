import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 서류 승인 직후 '예약승인'을 눌렀던 예약만 전자계약 자동 발행 (2026-10-15, Migration #718)
 */
const autoIssueCalls: number[] = []
let autoIssueResult: unknown = { status: 'sent', contractId: 'c1', templateTitle: '표준' }
let templateOn = true
vi.mock('$lib/server/contractAutoIssue', () => ({
  hasAutoIssueTemplate: vi.fn(async () => templateOn),
  autoIssueContractOnApproval: vi.fn(async (_d: unknown, id: number) => { autoIssueCalls.push(id); return typeof autoIssueResult === 'function' ? (autoIssueResult as (i: number) => unknown)(id) : autoIssueResult }),
}))

const APPROVED = {
  identity_doc_url: ['a', 'b'], identity_type: ['resident', 'resident_copy'],
  identity_verified_at: '2026-10-01T00:00:00Z', identity_approved_at: '2026-10-02T00:00:00Z',
}
const PENDING = { ...APPROVED, identity_approved_at: null }
let profile: Record<string, unknown> = APPROVED
let marked: Array<{ id: number }> = []
let selectError: { message: string } | null = null
const updates: Array<{ table: string; values: Record<string, unknown>; ids: number[] }> = []
let claimedOnce = false

function admin() {
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      let pendingUpdate: Record<string, unknown> | null = null
      Object.assign(chain, {
        select: () => (pendingUpdate
          ? Promise.resolve({ data: selectError ? null : (claimedOnce ? [] : marked), error: selectError }).then((r) => {
              if (!selectError) { updates.push({ table, values: pendingUpdate as Record<string, unknown>, ids: marked.map((m) => m.id) }); claimedOnce = true }
              return r
            })
          : chain),
        eq: () => chain, not: () => chain,
        maybeSingle: async () => ({ data: profile, error: null }),
        update: (values: Record<string, unknown>) => { pendingUpdate = values; return chain },
      })
      return chain
    },
  } as never
}

beforeEach(() => {
  autoIssueCalls.length = 0; updates.length = 0; claimedOnce = false
  autoIssueResult = { status: 'sent', contractId: 'c1', templateTitle: '표준' }
  templateOn = true; profile = APPROVED; marked = [{ id: 11 }, { id: 12 }]; selectError = null
})

describe('autoIssueAfterDocApproval', () => {
  it('표식이 있는 예약에만 자동발행하고 표식을 비운다', async () => {
    const { autoIssueAfterDocApproval } = await import('$lib/server/autoIssueOnDocApproval')
    autoIssueResult = (id: number) => (id === 11 ? { status: 'sent', contractId: 'c1', templateTitle: '표준' } : { status: 'skipped', reason: 'contract_exists', message: 'x' })
    const r = await autoIssueAfterDocApproval({ admin: admin(), fetch: fetch }, 'u1')
    expect(autoIssueCalls).toEqual([11, 12])
    expect(r.sent).toBe(1)
    expect(r.skippedMessages).toEqual([])
    expect(updates[0]).toMatchObject({ table: 'rental_reservations', values: { approve_requested_at: null }, ids: [11, 12] })
    expect(typeof updates[0].values.approved_at).toBe('string') // 서류 승인으로 예약승인 완료 기록
  })
  it('같은 표식을 두 번 처리해도(동시 승인) 두 번째는 아무것도 발행하지 않는다 — 표식을 먼저 가져가는(claim) 방식', async () => {
    const { autoIssueAfterDocApproval } = await import('$lib/server/autoIssueOnDocApproval')
    await autoIssueAfterDocApproval({ admin: admin(), fetch: fetch }, 'u1')
    const second = await autoIssueAfterDocApproval({ admin: admin(), fetch: fetch }, 'u1')
    expect(second).toEqual({ sent: 0, skippedMessages: [] })
    expect(autoIssueCalls).toEqual([11, 12])
  })
  it('표식이 있는 예약이 없으면 아무것도 하지 않는다', async () => {
    marked = []
    const { autoIssueAfterDocApproval } = await import('$lib/server/autoIssueOnDocApproval')
    const r = await autoIssueAfterDocApproval({ admin: admin(), fetch: fetch }, 'u1')
    expect(r).toEqual({ sent: 0, skippedMessages: [] })
    expect(autoIssueCalls).toHaveLength(0)
  })
  it('서류가 아직 승인 상태가 아니면 발행하지 않고 표식도 그대로 둔다', async () => {
    profile = PENDING
    const { autoIssueAfterDocApproval } = await import('$lib/server/autoIssueOnDocApproval')
    await autoIssueAfterDocApproval({ admin: admin(), fetch: fetch }, 'u1')
    expect(autoIssueCalls).toHaveLength(0)
    expect(updates).toHaveLength(0)
  })
  it('발행에 실패(건너뜀)해도 표식은 비우고 사유를 돌려준다', async () => {
    autoIssueResult = { status: 'skipped', reason: 'unresolved_variables', message: '채워지지 않은 항목' }
    const { autoIssueAfterDocApproval } = await import('$lib/server/autoIssueOnDocApproval')
    const r = await autoIssueAfterDocApproval({ admin: admin(), fetch: fetch }, 'u1')
    expect(r.sent).toBe(0)
    expect(r.skippedMessages).toEqual(['채워지지 않은 항목', '채워지지 않은 항목'])
    expect(updates[0].ids).toEqual([11, 12])
  })
  it('표준양식이 꺼져 있으면 발행하지 않고 표식만 비운다', async () => {
    templateOn = false
    const { autoIssueAfterDocApproval } = await import('$lib/server/autoIssueOnDocApproval')
    const r = await autoIssueAfterDocApproval({ admin: admin(), fetch: fetch }, 'u1')
    expect(autoIssueCalls).toHaveLength(0)
    expect(r.sent).toBe(0)
    expect(updates[0].ids).toEqual([11, 12])
  })
  it('표식 컬럼이 없는 환경(조회 오류)에서는 대상 없음으로 본다', async () => {
    selectError = { message: 'column approve_requested_at does not exist' }
    const { autoIssueAfterDocApproval } = await import('$lib/server/autoIssueOnDocApproval')
    const r = await autoIssueAfterDocApproval({ admin: admin(), fetch: fetch }, 'u1')
    expect(r).toEqual({ sent: 0, skippedMessages: [] })
    expect(updates).toHaveLength(0)
  })
})

describe('배선(소스 확인)', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')
  it('approve-doc은 서류 승인 성공 뒤 자동발행을 fail-soft로 호출한다', () => {
    const s = read('src/routes/api/cms/approve-doc/+server.ts')
    expect(s).toMatch(/try \{[\s\S]*autoIssueAfterDocApproval\(\{ admin, fetch \}, userId\)[\s\S]*\} catch/)
    expect(s.indexOf("rpc('approve_customer_doc'")).toBeLessThan(s.indexOf('autoIssueAfterDocApproval({'))
  })
  it('예약승인은 서류 미승인·승인대기일 때 승인 요청 표식을 기록한다', () => {
    const s = read('src/routes/cms/reservation/+page.server.ts')
    const seg = s.slice(s.indexOf('approve_requested_at'))
    expect(seg).toContain("approve_requested_at: new Date().toISOString()")
    expect(s).toMatch(/if \(gate === 'pending'\) \{\s*await markApproveRequested\(\)/)
    expect(s).toMatch(/if \(gate !== 'approved'\) \{\s*await markApproveRequested\(\)/)
  })
})
