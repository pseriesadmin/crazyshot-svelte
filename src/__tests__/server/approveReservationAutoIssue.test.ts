import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 예약승인 ↔ 전자계약 자동발행 연동 (2026-10-15, Stephen 확정)
 *  · 표준양식 없음(off): 확정하지 않는다 — 서류 미승인이면 등록요청, 승인이면 '표준양식 미지정' 안내만(서명·결제 없는 확정 경로 없음)
 *  · 자동발행 성공(sent): 예약은 확정하지 않는다(서명·결제 후) — 확정 RPC·승인 알림을 부르지 않고 contractIssued 를 돌려준다
 *  · 건너뜀(skipped): 확정하지 않고(신청대기 유지) 사유(contractSkipped)만 돌려준다 — 서명·결제 없는 확정 없음
 */
const rpc = vi.fn()
const autoIssue = vi.fn()
const notify = vi.fn()
const identity = vi.fn()
let autoIssueOn = true
let gateRow: Record<string, unknown> = {
  identity_doc_url: ['a', 'b'], identity_type: ['resident', 'resident_copy'],
  identity_verified_at: '2026-10-01T00:00:00Z', identity_approved_at: '2026-10-02T00:00:00Z',
}

vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessAction: async () => null, requireMenuAccessApi: async () => null }))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: async () => 'manager' }))
vi.mock('$lib/server/contractAutoIssue', () => ({
  autoIssueContractOnApproval: (...a: unknown[]) => autoIssue(...a),
  hasAutoIssueTemplate: async () => autoIssueOn,
}))
vi.mock('$lib/server/reservationApprovalNotify', () => ({ resolveApprovalNotifyPlan: async () => ({ mode: 'single' }) }))
vi.mock('$lib/server/sendApprovalNotifications', () => ({ sendApprovalNotifications: (...a: unknown[]) => notify(...a) }))
vi.mock('$lib/server/identityDocRequest', () => ({ requestIdentityDocRegistration: (...a: unknown[]) => identity(...a) }))
vi.mock('@supabase/supabase-js', () => {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {}
    const self = () => b
    b['select'] = self
    b['eq'] = self
    b['in'] = self
    b['maybeSingle'] = async () => (table === 'order_items' ? { data: null } : table === 'user_profiles' ? { data: gateRow } : { data: { user_id: 'u1' } })
    ;(b as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve({ data: [{ id: 55 }], error: null }) // hold 조회
    return b
  }
  return { createClient: () => ({ from: builder, rpc: (...a: unknown[]) => rpc(...a) }) }
})

import { actions } from '../../routes/cms/reservation/+page.server'

function run() {
  const fd = new FormData()
  fd.set('reservation_id', '55')
  const request = new Request('http://x', { method: 'POST', body: fd })
  const locals = { safeGetSession: async () => ({ session: { user: { id: 'admin1' } } }) }
  const handler = (actions as unknown as { approveReservation: (e: unknown) => Promise<unknown> }).approveReservation
  return handler({ request, locals, fetch: vi.fn() })
}

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: { ok: true }, error: null })
  autoIssue.mockReset()
  notify.mockReset()
  identity.mockReset()
  autoIssueOn = true
  gateRow = {
    identity_doc_url: ['a', 'b'], identity_type: ['resident', 'resident_copy'],
    identity_verified_at: '2026-10-01T00:00:00Z', identity_approved_at: '2026-10-02T00:00:00Z',
  }
})

describe('approveReservation + 자동발행', () => {
  it('자동발행은 승인 대상 예약(primaryId)으로 호출한다', async () => {
    autoIssue.mockResolvedValue({ status: 'sent', contractId: 'c1', templateTitle: 't' })
    await run()
    expect(autoIssue.mock.calls[0]![1]).toBe(55)
  })

  it('표준양식이 없으면(토글 OFF) 서류가 승인돼 있어도 확정하지 않고 승인완료로 기록한 뒤 수동 발행을 안내한다', async () => {
    autoIssueOn = false
    const r = await run()
    expect(r).toEqual({ ok: true, approvedManual: true })
    expect(autoIssue).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('표준양식이 없어도(토글 OFF) 서류 미등록 고객에게는 등록요청을 보내고 확정하지 않는다', async () => {
    autoIssueOn = false
    gateRow = {}
    identity.mockResolvedValue({ requested: true, reason: 'sent' })
    const r = await run()
    expect(r).toMatchObject({ ok: true, identityRequested: true })
    expect(identity).toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('자동발행에 성공하면 예약을 확정하지 않고(서명·결제 후) 승인 알림도 보내지 않는다', async () => {
    autoIssue.mockResolvedValue({ status: 'sent', contractId: 'c1', templateTitle: '표준 대여계약서' })
    const r = await run()
    expect(r).toEqual({ ok: true, contractIssued: true, contractTitle: '표준 대여계약서' })
    expect(rpc).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
    expect(identity).not.toHaveBeenCalled() // 서류 승인 완료 고객이라 등록요청은 보내지 않는다
  })

  it('자동발행을 건너뛰면(양식 문제 등) 예약을 확정하지 않고 사유만 돌려준다(서명·결제 없는 확정 없음)', async () => {
    autoIssue.mockResolvedValue({ status: 'skipped', reason: 'unresolved_variables', message: '채워지지 않은 항목이 있어요' })
    const r = await run()
    expect(r).toEqual({ ok: true, contractNotIssued: true, contractSkipped: '채워지지 않은 항목이 있어요' })
    expect(rpc).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('서류는 등록했으나 승인 대기(승인 취소 포함) → 요청 카드 없이 승인대기 안내만', async () => {
    gateRow = {
      identity_doc_url: ['a', 'b'], identity_type: ['resident', 'resident_copy'],
      identity_verified_at: '2026-10-05T00:00:00Z', identity_approved_at: null,
    }
    const r = await run()
    expect(r).toEqual({ ok: true, identityPending: true })
    expect(identity).not.toHaveBeenCalled()
    expect(autoIssue).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('자동발행이 예외를 던져도 예약을 확정하지 않고 안내만 돌려준다', async () => {
    autoIssue.mockRejectedValue(new Error('boom'))
    const r = (await run()) as { ok: boolean; contractNotIssued?: boolean; contractSkipped?: string }
    expect(r.ok).toBe(true)
    expect(r.contractNotIssued).toBe(true)
    expect(r.contractSkipped).toContain('자동발행')
    expect(rpc).not.toHaveBeenCalled()
  })
})
