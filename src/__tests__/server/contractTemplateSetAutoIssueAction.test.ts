import { describe, it, expect, vi, beforeEach } from 'vitest'

/** 계약서 양식 화면의 '자동발행 표준양식' 토글 저장 액션(setAutoIssue) — 권한·입력 검증·RPC 결과 매핑 (2026-10-15) */
const rpc = vi.fn()
let role: string | null = 'manager'
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: async () => role }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: (...a: unknown[]) => rpc(...a), from: () => ({}) }) }))

import { actions } from '../../routes/cms/reservation/contracts/+page.server'

const ID = '123e4567-e89b-12d3-a456-426614174000'
function call(fields: Record<string, string>, session = true) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  const handler = (actions as unknown as { setAutoIssue: (e: unknown) => Promise<{ status?: number; data?: unknown } | Record<string, unknown>> }).setAutoIssue
  return handler({
    request: new Request('http://x', { method: 'POST', body: fd }),
    locals: { safeGetSession: async () => ({ session: session ? { user: { id: 'a' } } : null }) },
  })
}

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: { ok: true, on: true }, error: null })
  role = 'manager'
})

describe('setAutoIssue 액션', () => {
  it('세션이 없으면 401', async () => {
    expect(await call({ id: ID, on: 'true' }, false)).toMatchObject({ status: 401 })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('manager 미만(partner)은 403', async () => {
    role = 'partner'
    expect(await call({ id: ID, on: 'true' })).toMatchObject({ status: 403 })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('올바르지 않은 양식 ID는 400', async () => {
    expect(await call({ id: 'not-a-uuid', on: 'true' })).toMatchObject({ status: 400 })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('켜기/끄기를 RPC에 그대로 전달하고 결과를 돌려준다', async () => {
    expect(await call({ id: ID, on: 'true' })).toEqual({ ok: true, on: true })
    expect(rpc).toHaveBeenLastCalledWith('cms_set_auto_issue_template', { p_template_id: ID, p_on: true })
    rpc.mockResolvedValue({ data: { ok: true, on: false }, error: null })
    expect(await call({ id: ID, on: 'false' })).toEqual({ ok: true, on: false })
    expect(rpc).toHaveBeenLastCalledWith('cms_set_auto_issue_template', { p_template_id: ID, p_on: false })
  })
  it('보관(비활성) 양식은 사람이 읽을 수 있는 안내로 400', async () => {
    rpc.mockResolvedValue({ data: { ok: false, error: 'template_not_active' }, error: null })
    const r = (await call({ id: ID, on: 'true' })) as { status: number; data: { error: string } }
    expect(r.status).toBe(400)
    expect(r.data.error).toContain('활성')
  })
})
