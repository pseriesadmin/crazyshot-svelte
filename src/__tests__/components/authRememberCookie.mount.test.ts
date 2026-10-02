// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createBrowserClient } from '@supabase/ssr'
import { createBrowserCookieAdapter, setRememberChoice, REMEMBER_COOKIE } from '$lib/utils/authCookies'

/**
 * 실제 @supabase/ssr 브라우저 클라이언트 + 쿠키 어댑터 통합 확인 (2026-10-02)
 * 로그인 유지 표식이 '0'이면 인증 쿠키가 Max-Age 없는 세션 쿠키로, '1'이면 장기 쿠키로 기록되는지 확인한다.
 * 실행: npm run test:component
 */

function fakeJwt(): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`
}

const writes: string[] = []
let realDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
  writes.length = 0
  realDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
  // document.cookie 쓰기를 가로채 원문 Set-Cookie 줄을 기록(동시에 실제 jar에도 반영)
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get() { return realDescriptor?.get?.call(document) ?? '' },
    set(v: string) { writes.push(v); realDescriptor?.set?.call(document, v) },
  })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'a@b.c' }), { status: 200, headers: { 'content-type': 'application/json' } })))
})
afterEach(() => {
  delete (document as unknown as Record<string, unknown>).cookie
  document.cookie = `${REMEMBER_COOKIE}=; Max-Age=0; Path=/`
  vi.unstubAllGlobals()
})

async function signedInAuthCookieLines(remember: boolean | null): Promise<string[]> {
  if (remember !== null) setRememberChoice(remember)
  writes.length = 0
  const client = createBrowserClient('https://proj.supabase.co', 'anon-key', { cookies: createBrowserCookieAdapter(), isSingleton: false })
  await client.auth.setSession({ access_token: fakeJwt(), refresh_token: 'r-token' })
  return writes.filter((l) => l.startsWith('sb-'))
}

describe.skipIf(!process.env.CS_COMPONENT_TEST)('로그인 유지 표식 → 인증 쿠키 수명', () => {
  it("유지 안 함('0') → 인증 쿠키에 Max-Age 없음(세션 쿠키)", async () => {
    const lines = await signedInAuthCookieLines(false)
    expect(lines.length).toBeGreaterThan(0)
    for (const l of lines) expect(l).not.toContain('Max-Age')
  })

  it("유지함('1') → 인증 쿠키에 장기 Max-Age", async () => {
    const lines = await signedInAuthCookieLines(true)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.some((l) => /Max-Age=\d{7,}/.test(l))).toBe(true)
  })

  it('표식 없음(기존 사용자) → 장기 Max-Age 유지', async () => {
    const lines = await signedInAuthCookieLines(null)
    expect(lines.some((l) => /Max-Age=\d{7,}/.test(l))).toBe(true)
  })
})
