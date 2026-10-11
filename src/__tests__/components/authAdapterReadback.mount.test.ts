// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createBrowserClient } from '@supabase/ssr'
import { createBrowserCookieAdapter } from '$lib/utils/authCookies'

/** 쿠키 어댑터로 저장한 세션을 새 클라이언트(=페이지 새로고침/다른 모듈)가 다시 읽을 수 있는지 — 읽지 못하면 anon 으로 RPC 호출된다 */
function fakeJwt(): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`
}
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'a@b.c' }), { status: 200, headers: { 'content-type': 'application/json' } })))
})
afterEach(() => { document.cookie.split(';').forEach((c) => { const n = c.split('=')[0].trim(); if (n) document.cookie = `${n}=; Max-Age=0; Path=/` }); vi.unstubAllGlobals() })

describe.skipIf(!process.env.CS_COMPONENT_TEST)('쿠키 어댑터 읽기(round trip)', () => {
  for (const remember of [undefined, '1', '0']) {
    it(`표식=${remember ?? '없음'} — 저장한 세션을 새 클라이언트가 읽는다`, async () => {
      if (remember) document.cookie = `cs-remember=${remember}; Path=/`
      const a = createBrowserClient('https://proj.supabase.co', 'anon', { cookies: createBrowserCookieAdapter(), isSingleton: false })
      const token = fakeJwt()
      await a.auth.setSession({ access_token: token, refresh_token: 'r-token' })
      const b = createBrowserClient('https://proj.supabase.co', 'anon', { cookies: createBrowserCookieAdapter(), isSingleton: false })
      const { data } = await b.auth.getSession()
      expect(data.session?.access_token).toBe(token)
    })
  }
})
