import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cmsRememberCookieOptions, CMS_REMEMBER_MAX_AGE } from '$lib/server/cmsRememberCookie'

/**
 * CMS 로그인 유지 표식(cms-remember) — 수명 일치·관리자 세션 자동 발급 (2026-10-24)
 *  · 표식 수명 = 실제 로그인 쿠키(400일) / 유지 안 함 = 세션 쿠키
 *  · 표식이 없어도 관리자(cms_role) 세션이면 로그아웃시키지 않고 표식을 새로 발급한다(비관리자만 기존처럼 로그아웃)
 */

vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw Object.assign(new Error(`Redirect ${status}`), { status, location })
  },
}))
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'k' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://test.supabase.co' }))
const mockFetchCmsProfile = vi.fn()
vi.mock('$lib/server/cmsProfile', () => ({ fetchCmsProfileByAuthId: (...a: unknown[]) => mockFetchCmsProfile(...a) }))
const mockInsert = vi.fn().mockResolvedValue({ error: null })
const mockFrom = vi.fn((table: string) => ({
  select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
  insert: (row: unknown) => mockInsert(table, row),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: mockFrom }) }))

const { load } = await import('../../routes/cms/+layout.server')

function makeEvent(cookieValues: Record<string, string>, role: string | null) {
  mockFetchCmsProfile.mockResolvedValue(role ? { cms_role: role } : null)
  const signOut = vi.fn().mockResolvedValue({})
  const set = vi.fn()
  const event = {
    locals: {
      safeGetSession: vi.fn().mockResolvedValue({ session: { user: { id: "u1", email: "a@b.c" } } }),
      supabase: { auth: { signOut } },
    },
    url: new URL('https://test.local/cms/products'),
    request: new Request('https://test.local/cms/products', { headers: { 'user-agent': 'TestUA/1.0', 'x-forwarded-for': '203.0.113.7' } }),
    getClientAddress: () => '127.0.0.1',
    cookies: { getAll: vi.fn().mockReturnValue([]), get: (n: string) => cookieValues[n], set },
  } as unknown as Parameters<typeof load>[0]
  return { event, signOut, set }
}

describe('cmsRememberCookieOptions', () => {
  it('유지 선택: 400일 maxAge(로그인 쿠키 수명과 동일), httpOnly·secure·lax', () => {
    const o = cmsRememberCookieOptions(true)
    expect(o.maxAge).toBe(CMS_REMEMBER_MAX_AGE)
    expect(CMS_REMEMBER_MAX_AGE).toBe(60 * 60 * 24 * 400)
    expect(o).toMatchObject({ path: '/', httpOnly: true, secure: true, sameSite: 'lax' })
  })
  it('유지 안 함: maxAge 없는 세션 쿠키', () => {
    expect('maxAge' in cmsRememberCookieOptions(false)).toBe(false)
  })
})

describe('CMS 레이아웃 — 표식(cms-remember) 없음', () => {
  beforeEach(() => vi.clearAllMocks())

  it('관리자 세션: 로그아웃 없이 표식을 새로 발급하고 진행(기본 400일)', async () => {
    const { event, signOut, set } = makeEvent({}, 'manager')
    const r = await load(event)
    expect(r).toMatchObject({ cmsRole: 'manager' })
    expect(signOut).not.toHaveBeenCalled()
    expect(set).toHaveBeenCalledWith('cms-remember', '1', expect.objectContaining({ maxAge: CMS_REMEMBER_MAX_AGE }))
  })

  it('관리자 세션 자동 발급 시 CMS 접속 로그(cms_login_logs)에도 기록한다(IP·UA·역할 포함)', async () => {
    const { event } = makeEvent({}, 'manager')
    await load(event)
    expect(mockInsert).toHaveBeenCalledTimes(1)
    const [table, row] = mockInsert.mock.calls[0] as [string, Record<string, unknown>]
    expect(table).toBe('cms_login_logs')
    expect(row).toMatchObject({ user_id: 'u1', cms_role: 'manager', ip_address: '203.0.113.7', user_agent: 'TestUA/1.0' })
  })

  it('접속 로그 기록이 실패해도 접속은 막지 않는다(fail-soft)', async () => {
    mockInsert.mockRejectedValueOnce(new Error('db down'))
    const { event } = makeEvent({}, 'manager')
    await expect(load(event)).resolves.toMatchObject({ cmsRole: 'manager' })
  })

  it("로그인 선택이 '유지 안 함'(cs-remember=0)이면 세션 쿠키로 발급", async () => {
    const { event, set } = makeEvent({ 'cs-remember': '0' }, 'manager')
    await load(event)
    const opts = set.mock.calls[0][2] as Record<string, unknown>
    expect('maxAge' in opts).toBe(false)
  })

  it('비관리자 세션: 기존처럼 로그아웃 + 로그인 화면으로 이동, 표식 발급 없음', async () => {
    const { event, signOut, set } = makeEvent({}, null)
    await expect(load(event)).rejects.toMatchObject({ status: 303 })
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(set).not.toHaveBeenCalled()
  })

  it('표식이 있으면 발급·로그아웃 없이 통과(회귀 없음)', async () => {
    const { event, signOut, set } = makeEvent({ 'cms-remember': '1' }, 'manager')
    await load(event)
    expect(signOut).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
    expect(mockInsert).not.toHaveBeenCalled()
  })
})
