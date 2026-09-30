import { describe, it, expect, vi, beforeEach } from 'vitest'

/** POST /api/cms/reservations/[id]/confirm-cancel — 고객 취소 "취소중"의 관리자 취소확인 */

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'svc-key' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))
vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, async json() { return data } }),
}))
const mockRole = vi.fn()
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: (...a: unknown[]) => mockRole(...a) }))

let perms: Array<{ menu_key: string; allowed: boolean }> = []
const mockRpc = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.then = (resolve: (v: { data: unknown }) => void) => resolve({ data: perms })
      return b
    },
    rpc: (...a: unknown[]) => mockRpc(...a),
  }),
}))

const locals = (uid: string | null = 'admin-1') => ({
  safeGetSession: vi.fn().mockResolvedValue({ session: uid ? { user: { id: uid } } : null }),
})

describe('POST confirm-cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRole.mockResolvedValue('manager')
    perms = []
    mockRpc.mockResolvedValue({ data: { ok: true, confirmed_count: 1 }, error: null })
  })
  async function call(l = locals(), id = '15729') {
    const { POST } = await import('../../routes/api/cms/reservations/[id]/confirm-cancel/+server')
    return await POST({ params: { id }, locals: l } as never) as { status: number; json: () => Promise<Record<string, unknown>> }
  }

  it('CF-1 세션 없음 → 401', async () => { expect((await call(locals(null))).status).toBe(401) })
  it('CF-2 CMS 권한 없음 → 403', async () => {
    mockRole.mockResolvedValue(null)
    expect((await call()).status).toBe(403)
    expect(mockRpc).not.toHaveBeenCalled()
  })
  it('CF-3 예약ID 형식 오류 → 400', async () => { expect((await call(locals(), 'abc')).status).toBe(400) })
  it('CF-4 rental.change_cancel 권한을 계정별로 끈 관리자 → 403', async () => {
    perms = [{ menu_key: 'rental.change_cancel', allowed: false }]
    const res = await call()
    expect(res.status).toBe(403)
    expect(mockRpc).not.toHaveBeenCalled()
  })
  it('CF-5 정상 → confirm_customer_cancel RPC(예약ID·관리자ID) 호출, 성공 응답', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, confirmedCount: 1 })
    expect(mockRpc).toHaveBeenCalledWith('confirm_customer_cancel', { p_reservation_id: 15729, p_admin_id: 'admin-1' })
  })
  it('CF-6 고객이 취소한 예약이 아니면 400(취소확인 대상 아님)', async () => {
    mockRpc.mockResolvedValue({ data: { ok: false, error: 'not_customer_cancelled' }, error: null })
    const res = await call()
    expect(res.status).toBe(400)
    expect(String((await res.json()).error)).toContain('취소확인 대상이 아닙니다')
  })
  it('CF-7 이미 확인된 예약 재호출 → 200 already', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true, already: true, confirmed_count: 0 }, error: null })
    expect(await (await call()).json()).toMatchObject({ ok: true, already: true })
  })
  it('CF-8 RPC 오류 → 500', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect((await call()).status).toBe(500)
  })
})
