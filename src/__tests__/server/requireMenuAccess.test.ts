import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * requireMenuAccess — 계정별 메뉴 접근 권한(cms_menu_permissions 오버레이)의 서버 집행 공용 검사 (1단계 1a, 2026-10-03)
 *
 * 핵심 불변조건:
 *  ① 무회귀 — 오버라이드가 없거나 ON인 계정은 이전과 동일하게 통과
 *  ② OFF 오버라이드는 role과 무관하게 거부(슈퍼관리자 포함 — hasMenuAccess 의미 그대로)
 *  ③ 좁히기 전용 — role이 막은 메뉴는 ON 오버라이드로도 열리지 않음
 *  ④ 조회 실패·서비스 키 없음 = 차단(fail-closed, Stephen 확정 2026-10-03)
 *  ⑤ 요청 단위(locals) 캐싱 — 같은 요청에서 DB 조회 1회
 */

vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://test.supabase.co' }))

let mockRole: string | null = 'partner'
vi.mock('$lib/server/getCmsRoleForAction', () => ({
  getCmsRoleForAction: vi.fn(async () => mockRole),
}))

let mockOverrides: { menu_key: string; allowed: boolean }[] | null = []
let mockOverridesError: { message: string } | null = null
const eqSpy = vi.fn(() => Promise.resolve({ data: mockOverrides, error: mockOverridesError }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({ select: () => ({ eq: eqSpy }) }) }),
}))

const envState = { key: 'test-service-role-key' as string | undefined }
vi.mock('$env/dynamic/private', () => ({
  env: new Proxy({}, { get: (_t, p) => (p === 'SUPABASE_SERVICE_ROLE_KEY' ? envState.key : undefined) }),
}))

const { checkMenuAccess, checkAnyMenuAccess, requireMenuAccessApi, requireAnyMenuAccessApi, requireMenuAccessAction } = await import('$lib/server/requireMenuAccess')

function makeLocals(session: boolean = true) {
  return {
    safeGetSession: async () => ({ session: session ? { user: { id: 'u1' } } : null }),
  } as never
}

describe('checkMenuAccess', () => {
  beforeEach(() => {
    mockRole = 'partner'
    mockOverrides = []
    mockOverridesError = null
    envState.key = 'test-service-role-key'
    eqSpy.mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('오버라이드 없음 → 파트너(기본허용 메뉴)·매니저 통과 (무회귀)', async () => {
    expect(await checkMenuAccess(makeLocals(), 'consulting.chat')).toEqual({ ok: true, cmsRole: 'partner' })
    mockRole = 'manager'
    expect(await checkMenuAccess(makeLocals(), 'consulting.chat')).toEqual({ ok: true, cmsRole: 'manager' })
  })

  it('ON 오버라이드는 영향 없음 (통과 유지)', async () => {
    mockOverrides = [{ menu_key: 'consulting.chat', allowed: true }]
    expect((await checkMenuAccess(makeLocals(), 'consulting.chat')).ok).toBe(true)
  })

  it('OFF 오버라이드 → partner·manager·superadmin 모두 403', async () => {
    mockOverrides = [{ menu_key: 'consulting.chat', allowed: false }]
    for (const role of ['partner', 'manager', 'superadmin']) {
      mockRole = role
      const r = await checkMenuAccess(makeLocals(), 'consulting.chat')
      expect(r).toMatchObject({ ok: false, status: 403 })
    }
  })

  it('다른 메뉴의 OFF는 이 메뉴에 영향 없음', async () => {
    mockOverrides = [{ menu_key: 'products.list', allowed: false }]
    expect((await checkMenuAccess(makeLocals(), 'consulting.chat')).ok).toBe(true)
  })

  it('좁히기 전용: role이 막은 메뉴(파트너·구독목록)는 ON 오버라이드로도 거부', async () => {
    mockOverrides = [{ menu_key: 'subscription.list', allowed: true }]
    expect(await checkMenuAccess(makeLocals(), 'subscription.list')).toMatchObject({ ok: false, status: 403 })
  })

  it('세션 없음 → 401', async () => {
    expect(await checkMenuAccess(makeLocals(false), 'consulting.chat')).toMatchObject({ ok: false, status: 401 })
    expect(eqSpy).not.toHaveBeenCalled()
  })

  it('CMS 권한 없는 세션(고객) → 403, 오버라이드 조회도 하지 않음', async () => {
    mockRole = null
    expect(await checkMenuAccess(makeLocals(), 'consulting.chat')).toMatchObject({ ok: false, status: 403 })
    expect(eqSpy).not.toHaveBeenCalled()
  })

  it('조회 오류 → fail-closed 403 (throw 없음)', async () => {
    mockOverrides = null
    mockOverridesError = { message: 'db down' }
    const r = await checkMenuAccess(makeLocals(), 'consulting.chat')
    expect(r).toMatchObject({ ok: false, status: 403 })
    expect((r as { error: string }).error).toContain('권한 정보를 확인하지 못해')
  })

  it('서비스 키 없음 → fail-closed 403', async () => {
    envState.key = undefined
    expect(await checkMenuAccess(makeLocals(), 'consulting.chat')).toMatchObject({ ok: false, status: 403 })
  })

  it('같은 요청(locals)에서 2회 검사해도 조회는 1회 (요청 단위 캐시)', async () => {
    const locals = makeLocals()
    await checkMenuAccess(locals, 'consulting.chat')
    await checkMenuAccess(locals, 'products.list')
    expect(eqSpy).toHaveBeenCalledTimes(1)
  })

  it('다른 요청(locals)은 각자 조회한다', async () => {
    await checkMenuAccess(makeLocals(), 'consulting.chat')
    await checkMenuAccess(makeLocals(), 'consulting.chat')
    expect(eqSpy).toHaveBeenCalledTimes(2)
  })

  it('존재하지 않는 메뉴 키는 거부(오타로 인한 무방비 방지)', async () => {
    expect(await checkMenuAccess(makeLocals(), 'no.such.menu')).toMatchObject({ ok: false, status: 403 })
  })
})

describe('래퍼', () => {
  beforeEach(() => {
    mockRole = 'partner'
    mockOverrides = []
    mockOverridesError = null
    envState.key = 'test-service-role-key'
    eqSpy.mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('requireMenuAccessApi: 통과 시 null', async () => {
    expect(await requireMenuAccessApi(makeLocals(), 'consulting.chat')).toBeNull()
  })

  it('requireMenuAccessApi: 거부 시 JSON Response(status·error)', async () => {
    mockOverrides = [{ menu_key: 'consulting.chat', allowed: false }]
    const res = await requireMenuAccessApi(makeLocals(), 'consulting.chat')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
    expect(((await res!.json()) as { error: string }).error).toBeTruthy()
  })

  it('requireMenuAccessAction: 통과 시 null, 거부 시 fail(status,{error})', async () => {
    expect(await requireMenuAccessAction(makeLocals(), 'consulting.chat')).toBeNull()
    mockOverrides = [{ menu_key: 'consulting.chat', allowed: false }]
    const f = await requireMenuAccessAction(makeLocals(), 'consulting.chat')
    expect(f).not.toBeNull()
    expect(f!.status).toBe(403)
    expect((f!.data as { error: string }).error).toBeTruthy()
  })
})

describe('checkAnyMenuAccess — 여러 메뉴 중 하나라도 허용이면 통과 (공용 API용, 1b)', () => {
  beforeEach(() => {
    mockRole = 'partner'
    mockOverrides = []
    mockOverridesError = null
    envState.key = 'test-service-role-key'
    eqSpy.mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('오버라이드 없음 → 통과 (무회귀)', async () => {
    expect((await checkAnyMenuAccess(makeLocals(), ['consulting.chat', 'consulting.qna'])).ok).toBe(true)
  })

  it('하나만 OFF → 통과 (다른 메뉴가 허용)', async () => {
    mockOverrides = [{ menu_key: 'consulting.chat', allowed: false }]
    expect((await checkAnyMenuAccess(makeLocals(), ['consulting.chat', 'consulting.qna'])).ok).toBe(true)
    mockOverrides = [{ menu_key: 'consulting.qna', allowed: false }]
    expect((await checkAnyMenuAccess(makeLocals(), ['consulting.chat', 'consulting.qna'])).ok).toBe(true)
  })

  it('전부 OFF → 403', async () => {
    mockOverrides = [{ menu_key: 'consulting.chat', allowed: false }, { menu_key: 'consulting.qna', allowed: false }]
    expect(await checkAnyMenuAccess(makeLocals(), ['consulting.chat', 'consulting.qna'])).toMatchObject({ ok: false, status: 403 })
  })

  it('빈 키 목록은 거부(무방비 방지)', async () => {
    expect(await checkAnyMenuAccess(makeLocals(), [])).toMatchObject({ ok: false, status: 403 })
  })

  it('세션 없음 401 / 고객 403 / 조회 실패 fail-closed 403', async () => {
    expect(await checkAnyMenuAccess(makeLocals(false), ['consulting.chat'])).toMatchObject({ ok: false, status: 401 })
    mockRole = null
    expect(await checkAnyMenuAccess(makeLocals(), ['consulting.chat'])).toMatchObject({ ok: false, status: 403 })
    mockRole = 'partner'
    mockOverrides = null
    mockOverridesError = { message: 'db down' }
    expect(await checkAnyMenuAccess(makeLocals(), ['consulting.chat', 'consulting.qna'])).toMatchObject({ ok: false, status: 403 })
  })

  it('여러 키를 검사해도 조회는 1회', async () => {
    await checkAnyMenuAccess(makeLocals(), ['consulting.chat', 'consulting.qna'])
    expect(eqSpy).toHaveBeenCalledTimes(1)
  })

  it('requireAnyMenuAccessApi: 통과 null / 거부 403 Response', async () => {
    expect(await requireAnyMenuAccessApi(makeLocals(), ['consulting.chat', 'consulting.qna'])).toBeNull()
    mockOverrides = [{ menu_key: 'consulting.chat', allowed: false }, { menu_key: 'consulting.qna', allowed: false }]
    const res = await requireAnyMenuAccessApi(makeLocals(), ['consulting.chat', 'consulting.qna'])
    expect(res!.status).toBe(403)
  })
})
