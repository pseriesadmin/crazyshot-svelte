import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 보안 베이스라인 B-1 (2026-10-20) — 로그인 후 ?redirect= Open Redirect
 * 로그인 직후 외부 URL 로 이동시키면 피싱으로 이어진다 → 사이트 내부 경로(safeReturnPath)만 허용하고 그 외는 '/' 로.
 * 기존 정상 흐름(내부에서 만드는 /cart, /account/..., /subscribe/..?x=y)은 그대로 동작해야 한다.
 */
const state: { session: { user: { id: string; is_anonymous?: boolean } } | null; cmsRole: string | null } = {
  session: null, cmsRole: null,
}

vi.mock('$lib/utils/loginBanner', () => ({
  parseLoginBannerSettings: () => ({}),
  orderLoginBanners: () => [],
}))

async function run(redirectParam: string | null): Promise<{ status: number; location: string } | 'no-redirect'> {
  const { load } = await import('../../routes/auth/login/+page.server')
  const url = new URL('https://crazyshot.kr/auth/login' + (redirectParam === null ? '' : `?redirect=${encodeURIComponent(redirectParam)}`))
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    is: () => chain,
    lte: () => chain,
    gte: () => chain,
    or: () => chain,
    order: () => chain,
    limit: () => chain,
    single: async () => ({ data: { cms_role: state.cmsRole }, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
    then: (res: (v: unknown) => unknown) => res({ data: [], error: null }),
  }
  const locals = {
    safeGetSession: async () => ({ session: state.session }),
    supabase: { from: () => chain },
  } as unknown as Parameters<typeof load>[0]['locals']
  try {
    await load({ locals, url } as unknown as Parameters<typeof load>[0])
    return 'no-redirect'
  } catch (e) {
    const r = e as { status?: number; location?: string }
    if (r && typeof r.location === 'string') return { status: r.status ?? 0, location: r.location }
    throw e
  }
}

describe('로그인 페이지 load — 로그인된 일반 회원의 redirect 처리 (B-1)', () => {
  beforeEach(() => { state.session = { user: { id: 'u1', is_anonymous: false } }; state.cmsRole = null })

  it.each([
    ['/cart', '/cart'],
    ['/account/rental/abc', '/account/rental/abc'],
    ['/subscribe/p1?x=1#y', '/subscribe/p1?x=1#y'],
  ])('내부 경로는 그대로 이동: %s', async (input, expected) => {
    expect(await run(input)).toEqual({ status: 303, location: expected })
  })

  it.each([
    ['https://evil.com'], ['//evil.com'], ['/\\evil.com'], ['javascript:alert(1)'], ['evil.com'], ['http://crazyshot.kr.evil.com/'],
  ])('외부·위험 경로는 "/" 로 대체: %s', async (input) => {
    expect(await run(input)).toEqual({ status: 303, location: '/' })
  })

  it('redirect 가 없으면 "/" 로 이동(기존 동작)', async () => {
    expect(await run(null)).toEqual({ status: 303, location: '/' })
  })
})

describe('가드: 로그인 화면의 모든 redirect/goto 가 safeReturnPath 를 거친다', () => {
  const svelte = readFileSync(join(process.cwd(), 'src/routes/auth/login/+page.svelte'), 'utf8')
  it('+page.svelte 는 searchParams redirect 를 safeReturnPath 없이 goto 하지 않는다', () => {
    const raw = svelte.match(/searchParams\.get\('redirect'\) \?\? '\/'/g) ?? []
    expect(raw.length).toBe(0)
    const safe = svelte.match(/safeReturnPath\(\$page\.url\.searchParams\.get\('redirect'\)\)/g) ?? []
    expect(safe.length).toBe(2)
  })
})
