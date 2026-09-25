import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * CMS 중앙 역할 게이트(hooks.server.ts) 단위 테스트
 * /cms/** 변경 요청(POST 등)은 어떤 cms_role이든 보유해야 통과한다.
 * 세부 등급 게이트는 각 액션이 담당 — 여기서는 "CMS 직원 여부"만 검증.
 */

vi.mock('$lib/env/supabasePublic', () => ({
  requireSupabasePublicEnv: () => ({ url: 'https://test.supabase.co', anonKey: 'anon' }),
}))

const authState: { session: { user: { id: string } } | null } = { session: null }
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: authState.session }, error: null }),
      getUser: async () => ({
        data: { user: authState.session?.user ?? null },
        error: authState.session ? null : new Error('no user'),
      }),
    },
  }),
}))

const fetchProfile = vi.fn()
vi.mock('$lib/server/cmsProfile', () => ({
  fetchCmsProfileByAuthId: (...args: unknown[]) => fetchProfile(...args),
}))

import { handle } from '../../hooks.server'

type Ev = Parameters<typeof handle>[0]['event']

function makeEvent(method: string, path: string): { event: Ev; resolve: ReturnType<typeof vi.fn> } {
  const url = new URL('https://crazyshot.kr' + path)
  const event = {
    url,
    request: new Request(url, { method }),
    cookies: { getAll: () => [], set: vi.fn() },
    locals: {},
  } as unknown as Ev
  const resolve = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
  return { event, resolve }
}

async function run(method: string, path: string): Promise<{ res: Response; resolve: ReturnType<typeof vi.fn> }> {
  const { event, resolve } = makeEvent(method, path)
  const res = await handle({ event, resolve } as unknown as Parameters<typeof handle>[0])
  return { res, resolve }
}

beforeEach(() => {
  authState.session = null
  fetchProfile.mockReset()
})

describe('CMS 중앙 게이트 — 거절', () => {
  it('(a) POST /cms/products 세션 없음 → 401, resolve 미호출', async () => {
    const { res, resolve } = await run('POST', '/cms/products?/updateSection')
    expect(res.status).toBe(401)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toHaveProperty('error')
    expect(resolve).not.toHaveBeenCalled()
  })

  it('(b) 세션 있으나 cms_role 없음(일반/익명 고객) → 403', async () => {
    authState.session = { user: { id: 'cust-1' } }
    fetchProfile.mockResolvedValue({ cms_role: null, name: 'x' })
    const { res, resolve } = await run('POST', '/cms/products?/deleteProduct')
    expect(res.status).toBe(403)
    expect(resolve).not.toHaveBeenCalled()
  })

  it('(b2) 프로필 자체가 없는 익명 사용자 → 403', async () => {
    authState.session = { user: { id: 'anon-1' } }
    fetchProfile.mockResolvedValue(null)
    const { res } = await run('POST', '/cms/products/new')
    expect(res.status).toBe(403)
  })

  it('(g) 역할 조회 예외 → 안전측 거절(403)', async () => {
    authState.session = { user: { id: 'u' } }
    fetchProfile.mockRejectedValue(new Error('db down'))
    const { res, resolve } = await run('POST', '/cms/products')
    expect(res.status).toBe(403)
    expect(resolve).not.toHaveBeenCalled()
  })

  it.each(['PUT', 'PATCH', 'DELETE'])('%s /cms/* 도 게이트 대상', async (m) => {
    const { res } = await run(m, '/cms/customers')
    expect(res.status).toBe(401)
  })

  it.each([
    ['끝 슬래시', '/cms/products/'],
    ['대소문자', '/CMS/products'],
    ['이중 슬래시', '//cms/products'],
    ['퍼센트 인코딩', '/%63ms/products'],
    ['/cms 루트', '/cms'],
    ['깊은 하위', '/cms/mobile/qr/abc'],
  ])('(h) 우회 시도 — %s → 401', async (_n, p) => {
    const { res, resolve } = await run('POST', p)
    expect(res.status).toBe(401)
    expect(resolve).not.toHaveBeenCalled()
  })
})

describe('CMS 중앙 게이트 — 통과', () => {
  it.each(['partner', 'manager', 'superadmin'])('(c) cms_role=%s → resolve 호출', async (role) => {
    authState.session = { user: { id: 'staff' } }
    fetchProfile.mockResolvedValue({ cms_role: role, name: 'n' })
    const { res, resolve } = await run('POST', '/cms/products?/updateSection')
    expect(res.status).toBe(200)
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('(d) GET /cms/products 는 DB 조회 없이 통과', async () => {
    const { res, resolve } = await run('GET', '/cms/products')
    expect(res.status).toBe(200)
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(fetchProfile).not.toHaveBeenCalled()
  })

  it('(d2) HEAD/OPTIONS 도 통과', async () => {
    for (const m of ['HEAD', 'OPTIONS']) {
      const { res } = await run(m, '/cms/products')
      expect(res.status).toBe(200)
    }
    expect(fetchProfile).not.toHaveBeenCalled()
  })

  it('(e) POST /cms/login 은 세션 없이도 통과', async () => {
    const { res, resolve } = await run('POST', '/cms/login?/login')
    expect(res.status).toBe(200)
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it.each(['/api/reservations', '/account/profile', '/cmsx/foo', '/auth/login'])(
    '(f) 비-CMS 경로 POST %s 무영향',
    async (p) => {
      const { res, resolve } = await run('POST', p)
      expect(res.status).toBe(200)
      expect(resolve).toHaveBeenCalledTimes(1)
      expect(fetchProfile).not.toHaveBeenCalled()
    },
  )
})
