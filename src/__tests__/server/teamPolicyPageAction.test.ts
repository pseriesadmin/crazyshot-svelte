import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

/** /cms/set/policy '팀 정책' — 저장 액션 권한·입력 가드, 화면 로드 값, 업로드 메뉴 키(2026-10-24) */

vi.mock('@sveltejs/kit', () => ({
  fail: (status: number, data?: Record<string, unknown>) => ({ status, data }),
  redirect: (status: number, location: string) => {
    throw Object.assign(new Error(`Redirect ${status}`), { status, location })
  },
}))
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://test.supabase.co' }))
vi.mock('$lib/utils/cmsPermissions', () => ({ hasSettingsAccess: (role: string) => ['superadmin', 'manager'].includes(role) }))

const mockGetCmsRoleForAction = vi.fn()
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: (...a: unknown[]) => mockGetCmsRoleForAction(...a) }))

function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit', 'neq', 'not']) c[m] = vi.fn(() => c)
  c.single = vi.fn().mockResolvedValue(result)
  c.maybeSingle = vi.fn().mockResolvedValue(result)
  c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
  return c
}
let tables: Record<string, { data: unknown; error: unknown }> = {}
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (t: string) => chain(tables[t] ?? { data: null, error: null }) }),
}))

const { actions, load } = await import('../../routes/cms/set/policy/+page.server')
type Fn = (e: unknown) => Promise<unknown>
const save = (actions as unknown as Record<string, Fn>).saveTeamPolicy

function locals(opts: { session?: boolean; rpcError?: string } = {}) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: opts.rpcError ? { message: opts.rpcError } : null })
  return { rpc, locals: { safeGetSession: vi.fn().mockResolvedValue({ session: opts.session === false ? null : { user: { id: 'u1' } } }), supabase: { rpc } } }
}
function req(fields: Record<string, string>): Request {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return { formData: async () => fd } as unknown as Request
}
const GOOD = JSON.stringify([{ type: 'text', html: '<p>팀 소개</p>' }])

beforeEach(() => {
  vi.clearAllMocks()
  tables = {}
  mockGetCmsRoleForAction.mockResolvedValue('manager')
})

describe('saveTeamPolicy 액션', () => {
  it('액션이 등록돼 있다', () => expect(typeof save).toBe('function'))

  it('세션 없으면 401, 역할 없음·partner면 403(저장 호출 없음)', async () => {
    const a = locals({ session: false })
    expect(await save({ request: req({ blocks: GOOD }), locals: a.locals })).toMatchObject({ status: 401 })
    for (const role of [null, 'partner']) {
      mockGetCmsRoleForAction.mockResolvedValue(role)
      const b = locals()
      expect(await save({ request: req({ blocks: GOOD }), locals: b.locals })).toMatchObject({ status: 403 })
      expect(b.rpc).not.toHaveBeenCalled()
    }
  })

  it('깨진 값·알 수 없는 블록은 400(저장 호출 없음)', async () => {
    for (const bad of ['', '{', JSON.stringify({ type: 'text' }), JSON.stringify([{ type: 'script' }])]) {
      const { locals: l, rpc } = locals()
      expect(await save({ request: req({ blocks: bad }), locals: l })).toMatchObject({ status: 400 })
      expect(rpc).not.toHaveBeenCalled()
    }
  })

  it('manager·superadmin은 정상 저장 — 검증된 배열이 RPC로 전달된다', async () => {
    for (const role of ['manager', 'superadmin']) {
      mockGetCmsRoleForAction.mockResolvedValue(role)
      const { locals: l, rpc } = locals()
      const r = await save({ request: req({ blocks: GOOD }), locals: l })
      expect(r).toMatchObject({ action: 'saveTeamPolicy', success: true })
      expect(rpc).toHaveBeenCalledWith('upsert_team_policy_settings', { p_blocks: JSON.parse(GOOD) })
    }
  })

  it('빈 배열(내용 비우기)도 저장된다', async () => {
    const { locals: l, rpc } = locals()
    expect(await save({ request: req({ blocks: '[]' }), locals: l })).toMatchObject({ success: true })
    expect(rpc).toHaveBeenCalledWith('upsert_team_policy_settings', { p_blocks: [] })
  })

  it('DB 오류는 500, 권한 거부(ACCESS_DENIED)는 403으로 구분하고 내부 문구를 그대로 노출하지 않는다', async () => {
    const a = locals({ rpcError: 'boom internal detail' })
    const r1 = (await save({ request: req({ blocks: GOOD }), locals: a.locals })) as { status: number; data: { error: string } }
    expect(r1.status).toBe(500)
    expect(r1.data.error).not.toContain('internal')
    const b = locals({ rpcError: 'ACCESS_DENIED' })
    expect(await save({ request: req({ blocks: GOOD }), locals: b.locals })).toMatchObject({ status: 403 })
  })
})

describe('saveTeamPolicy — DB 거절 사유별 안내', () => {
  it('BLOCKS_TOO_LARGE·INVALID_BLOCKS는 500이 아니라 400과 구체 안내', async () => {
    for (const [msg, hint] of [['BLOCKS_TOO_LARGE', '너무'], ['INVALID_BLOCKS', '형식']] as const) {
      const { locals: l } = locals({ rpcError: msg })
      const r = (await save({ request: req({ blocks: GOOD }), locals: l })) as { status: number; data: { error: string } }
      expect(r.status).toBe(400)
      expect(r.data.error).toContain(hint)
    }
  })
})

describe('팀 정책 — 화면 로드·업로드 키', () => {
  it('load가 teamBlocks(저장된 블록 배열, 없으면 빈 배열)를 돌려준다', async () => {
    const run = () => (load as unknown as Fn)({ locals: { safeGetSession: vi.fn().mockResolvedValue({ session: { user: { id: 'u1' } } }) }, parent: async () => ({ cmsRole: 'manager' }) }) as Promise<Record<string, unknown>>
    expect((await run()).teamBlocks).toEqual([])
    tables.team_policy_settings = { data: { content_blocks: [{ type: 'divider' }] }, error: null }
    expect((await run()).teamBlocks).toEqual([{ type: 'divider' }])
  })

  it('이 화면의 이미지 업로드가 막히지 않도록 UPLOAD_MENU_KEYS에 settings.policy가 있다', () => {
    const src = readFileSync('src/lib/server/uploadMenuKeys.ts', 'utf-8')
    expect(src).toContain("'settings.policy'")
  })
})
