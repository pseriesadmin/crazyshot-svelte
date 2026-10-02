import { describe, it, expect } from 'vitest'
import {
  REMEMBER_COOKIE,
  adjustAuthCookieOptions,
  parseCookies,
  serializeCookie,
  createBrowserCookieAdapter,
  setRememberChoice,
  type AuthCookieOptions,
} from '$lib/utils/authCookies'

/**
 * 로그인 유지(Remember me) — 인증 쿠키 수명 제어 (2026-10-02)
 *
 * 규칙: cs-remember 표식이 '0'(체크 안 함)이면 인증 쿠키를 세션 쿠키(maxAge·expires 제거)로 쓴다 — 브라우저를 닫으면 로그아웃.
 * '1'(체크함) 또는 표식 없음(이 기능 이전에 로그인한 기존 사용자)은 기존대로 장기 유지. 쿠키 삭제(maxAge<=0)는 항상 그대로 통과.
 */

describe('adjustAuthCookieOptions', () => {
  const base: AuthCookieOptions = { path: '/', sameSite: 'lax', maxAge: 34560000 }

  it("'0'이면 maxAge를 제거해 세션 쿠키로 만든다", () => {
    const r = adjustAuthCookieOptions(base, '0')
    expect(r.maxAge).toBeUndefined()
    expect(r.expires).toBeUndefined()
    expect(r.path).toBe('/')
    expect(r.sameSite).toBe('lax')
  })
  it("'0'이면 expires도 제거한다", () => {
    const r = adjustAuthCookieOptions({ ...base, expires: new Date(Date.now() + 86400000) }, '0')
    expect(r.expires).toBeUndefined()
  })
  it("'1'이면 그대로 장기 유지", () => {
    expect(adjustAuthCookieOptions(base, '1')).toEqual(base)
  })
  it('표식 없음(기존 사용자)이면 그대로 장기 유지', () => {
    expect(adjustAuthCookieOptions(base, undefined)).toEqual(base)
    expect(adjustAuthCookieOptions(base, null)).toEqual(base)
  })
  it("'0'이어도 삭제(maxAge 0·과거 expires)는 그대로 통과", () => {
    expect(adjustAuthCookieOptions({ ...base, maxAge: 0 }, '0').maxAge).toBe(0)
    const past = new Date(Date.now() - 1000)
    expect(adjustAuthCookieOptions({ path: '/', expires: past }, '0').expires).toBe(past)
  })
  it('원본 옵션 객체를 변경하지 않는다', () => {
    const o = { ...base }
    adjustAuthCookieOptions(o, '0')
    expect(o.maxAge).toBe(34560000)
  })
})

describe('parseCookies / serializeCookie', () => {
  it('document.cookie 문자열을 파싱하고 값은 디코딩한다', () => {
    expect(parseCookies('a=1; b=hello%20world; c=')).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: 'hello world' },
      { name: 'c', value: '' },
    ])
  })
  it('빈 문자열은 빈 배열', () => {
    expect(parseCookies('')).toEqual([])
  })
  it('깨진 인코딩은 원문 그대로', () => {
    expect(parseCookies('x=%E0%A4%A')).toEqual([{ name: 'x', value: '%E0%A4%A' }])
  })
  it('직렬화: 이름=값, path·max-age·samesite·secure', () => {
    expect(serializeCookie('k', 'v v', { path: '/', maxAge: 10, sameSite: 'lax', secure: true })).toBe(
      'k=v%20v; Path=/; Max-Age=10; SameSite=Lax; Secure',
    )
  })
  it('maxAge가 없으면 Max-Age를 쓰지 않는다(세션 쿠키)', () => {
    expect(serializeCookie('k', 'v', { path: '/' })).toBe('k=v; Path=/')
  })
  it('maxAge 0은 삭제용으로 그대로 직렬화한다', () => {
    expect(serializeCookie('k', '', { path: '/', maxAge: 0 })).toBe('k=; Path=/; Max-Age=0')
  })
})

describe('createBrowserCookieAdapter', () => {
  function fakeDoc(initial = '') {
    const jar = new Map<string, string>()
    initial.split('; ').filter(Boolean).forEach((p) => { const i = p.indexOf('='); jar.set(p.slice(0, i), p.slice(i + 1)) })
    const writes: string[] = []
    return {
      writes,
      get cookie() { return [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
      set cookie(line: string) { writes.push(line); const [pair] = line.split(';'); const i = pair.indexOf('='); jar.set(pair.slice(0, i), pair.slice(i + 1)) },
    }
  }

  it("표식 '0'이면 인증 쿠키를 Max-Age 없이 쓴다", () => {
    const doc = fakeDoc(`${REMEMBER_COOKIE}=0`)
    createBrowserCookieAdapter(doc).setAll([{ name: 'sb-x-auth-token', value: 'tok', options: { path: '/', maxAge: 34560000, sameSite: 'lax' } }], {})
    const line = doc.writes.at(-1) as string
    expect(line.startsWith('sb-x-auth-token=tok')).toBe(true)
    expect(line).not.toContain('Max-Age')
  })
  it("표식 '1'이면 Max-Age를 유지한다", () => {
    const doc = fakeDoc(`${REMEMBER_COOKIE}=1`)
    createBrowserCookieAdapter(doc).setAll([{ name: 'sb-x-auth-token', value: 'tok', options: { path: '/', maxAge: 34560000 } }], {})
    expect(doc.writes.at(-1)).toContain('Max-Age=34560000')
  })
  it('표식이 없으면 기존처럼 Max-Age를 유지한다', () => {
    const doc = fakeDoc('')
    createBrowserCookieAdapter(doc).setAll([{ name: 'sb-x-auth-token', value: 'tok', options: { path: '/', maxAge: 34560000 } }], {})
    expect(doc.writes.at(-1)).toContain('Max-Age=34560000')
  })
  it('getAll은 현재 쿠키를 돌려준다', () => {
    const doc = fakeDoc('a=1; b=2')
    expect(createBrowserCookieAdapter(doc).getAll()).toEqual([{ name: 'a', value: '1' }, { name: 'b', value: '2' }])
  })
})

describe('setRememberChoice', () => {
  it('체크 → 1, 해제 → 0, 1년 유지·path=/', () => {
    const writes: string[] = []
    const doc = { get cookie() { return '' }, set cookie(v: string) { writes.push(v) } }
    setRememberChoice(true, doc)
    setRememberChoice(false, doc)
    expect(writes[0]).toContain(`${REMEMBER_COOKIE}=1`)
    expect(writes[1]).toContain(`${REMEMBER_COOKIE}=0`)
    expect(writes[0]).toContain('Max-Age=31536000')
    expect(writes[0]).toContain('Path=/')
  })
})
