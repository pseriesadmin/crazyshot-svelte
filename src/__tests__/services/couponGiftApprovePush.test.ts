import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * POST /api/cms/chat/coupon-gift/[messageId]/approve — 승인 시 고객 푸시 (2026-09-25)
 *
 * 정상동작: 승인(거절 아님) 성공 시 event_coupon_issued 푸시가 카드의 discount_label과 함께 발송된다.
 * 막아야할것: 거절·RPC 실패 시 푸시 없음 / 푸시 조회·발송 예외가 승인 응답(ok:true)을 깨지 않음.
 */

vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }),
}))
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'test-key' } }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://example.supabase.co' }))

const mockGetCmsRoleForAction = vi.fn()
vi.mock('$lib/server/getCmsRoleForAction', () => ({
  getCmsRoleForAction: (...a: unknown[]) => mockGetCmsRoleForAction(...a),
}))

const mockPush = vi.fn(async (..._a: unknown[]) => ({ delivered: true, reason: 'sent' }))
vi.mock('$lib/server/push', () => ({ sendPushToUser: (...a: unknown[]) => mockPush(...a) }))

let messageResult: { data: unknown } | 'throw' = { data: null }
let ownedResult: { data: unknown } = { data: null }
const insertedRows: Array<{ table: string; row: Record<string, unknown> }> = []
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'limit', 'update']) chain[m] = () => chain
      chain.insert = (row: Record<string, unknown>) => { insertedRows.push({ table, row }); return chain }
      chain.single = async () => ({ data: { id: 'warn-1' }, error: null })
      chain.maybeSingle = async () => {
        if (table === 'user_coupons') return ownedResult
        if (messageResult === 'throw') throw new Error('조회 실패(시뮬레이션)')
        return messageResult
      }
      chain.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(r)
      return chain
    },
  }),
}))

const { POST } = await import('../../routes/api/cms/chat/coupon-gift/[messageId]/approve/+server')

const mockRpc = vi.fn()
function makeEvent(reject = false) {
  return {
    params: { messageId: 'msg-1' },
    request: { json: async () => ({ reject }) },
    locals: {
      safeGetSession: async () => ({ session: { user: { id: 'admin-uid' } } }),
      supabase: { rpc: mockRpc },
    },
  } as unknown as Parameters<typeof POST>[0]
}

describe('coupon-gift approve — 고객 푸시', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insertedRows.length = 0
    ownedResult = { data: null }
    mockGetCmsRoleForAction.mockResolvedValue('manager')
    messageResult = {
      data: { session_id: 's-1', action_payload: { coupon_id: 'c-1', discount_label: '3,000원 할인' }, chat_sessions: { user_id: 'customer-uid' } },
    }
  })

  it('승인 성공 → event_coupon_issued 푸시 발송(할인 라벨 포함)', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true, coupon_code: 'X' }, error: null })
    const r = (await POST(makeEvent(false))) as unknown as { status: number; data: { ok: boolean } }
    expect(r.data.ok).toBe(true)
    expect(mockPush).toHaveBeenCalledWith(
      'customer-uid',
      'event_coupon_issued',
      expect.objectContaining({ body: expect.stringContaining('3,000원 할인') }),
    )
  })

  it('거절 → 푸시 없음', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true, rejected: true }, error: null })
    await POST(makeEvent(true))
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('RPC 실패(예: 배포 중단) → 푸시 없음, 422', async () => {
    mockRpc.mockResolvedValue({ data: { ok: false, error: '쿠폰 발급에 실패했습니다: DISTRIBUTION_PAUSED' }, error: null })
    const r = (await POST(makeEvent(false))) as unknown as { status: number }
    expect(r.status).toBe(422)
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('푸시용 조회가 예외를 던져도 승인 응답은 ok:true 유지(fail-soft)', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null })
    messageResult = 'throw'
    const r = (await POST(makeEvent(false))) as unknown as { status: number; data: { ok: boolean } }
    expect(r.status).toBe(200)
    expect(r.data.ok).toBe(true)
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('이미 보유한 쿠폰 승인 시도 → 409 + 관리자 전용 경고 카드, RPC·푸시 없음', async () => {
    ownedResult = { data: { id: 'uc-1' } }
    const r = (await POST(makeEvent(false))) as unknown as { status: number; data: { error: string; duplicate: boolean } }
    expect(r.status).toBe(409)
    expect(r.data.error).toBe('이미 선물한 쿠폰입니다.')
    expect(mockRpc).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
    const warn = insertedRows.find((x) => x.table === 'chat_messages')?.row as Record<string, unknown>
    expect(warn.admin_only).toBe(true)
    expect((warn.action_payload as { type: string }).type).toBe('coupon_duplicate_warning')
  })

  it('거절은 보유 여부와 무관하게 허용(사전확인 생략)', async () => {
    ownedResult = { data: { id: 'uc-1' } }
    mockRpc.mockResolvedValue({ data: { ok: true, rejected: true }, error: null })
    const r = (await POST(makeEvent(true))) as unknown as { status: number }
    expect(r.status).toBe(200)
    expect(insertedRows).toHaveLength(0)
  })
})
