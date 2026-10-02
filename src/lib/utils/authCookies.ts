/**
 * 로그인 유지(Remember me) — 인증 쿠키 수명 제어 (2026-10-02)
 *
 * 로그인 화면에서 고른 선택을 `cs-remember` 표식 쿠키('1'=유지, '0'=유지 안 함)로 남기고, 서버(hooks.server.ts)와
 * 브라우저 Supabase 클라이언트(services/supabase.ts)가 인증 쿠키를 쓸 때 이 표식을 본다.
 *  - '0' → 세션 쿠키(maxAge·expires 제거): 브라우저를 닫으면 로그아웃
 *  - '1' 또는 표식 없음(이 기능 이전에 로그인한 기존 사용자) → 기존대로 장기 유지(@supabase/ssr 기본 400일)
 * 쿠키 삭제(maxAge<=0·과거 expires)는 어떤 경우에도 그대로 통과시킨다(로그아웃 동작 보호).
 */

export const REMEMBER_COOKIE = 'cs-remember'
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

export interface AuthCookieOptions {
  path?: string
  domain?: string
  maxAge?: number
  expires?: Date
  sameSite?: 'lax' | 'strict' | 'none' | boolean
  secure?: boolean
  httpOnly?: boolean
}

/** 표식이 '0'(로그인 유지 체크 안 함)인가 — 표식 없음·'1'은 모두 장기 유지 */
export function isSessionOnlyChoice(rememberValue: string | null | undefined): boolean {
  return rememberValue === '0'
}

/** 인증 쿠키 옵션을 표식에 맞게 조정한다. 원본 객체는 변경하지 않는다. */
export function adjustAuthCookieOptions<T extends AuthCookieOptions>(options: T, rememberValue: string | null | undefined): T {
  if (!isSessionOnlyChoice(rememberValue)) return options
  // 삭제 요청은 그대로
  if (typeof options.maxAge === 'number' && options.maxAge <= 0) return options
  if (options.expires && options.expires.getTime() <= Date.now()) return options
  const next = { ...options }
  delete next.maxAge
  delete next.expires
  return next
}

export function parseCookies(cookieString: string): { name: string; value: string }[] {
  if (!cookieString) return []
  return cookieString
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const i = part.indexOf('=')
      const name = i === -1 ? part : part.slice(0, i)
      const raw = i === -1 ? '' : part.slice(i + 1)
      let value = raw
      try { value = decodeURIComponent(raw) } catch { /* 깨진 인코딩은 원문 그대로 */ }
      return { name, value }
    })
}

export function serializeCookie(name: string, value: string, options: AuthCookieOptions = {}): string {
  let line = `${name}=${encodeURIComponent(value)}`
  if (options.path) line += `; Path=${options.path}`
  if (options.domain) line += `; Domain=${options.domain}`
  if (typeof options.maxAge === 'number') line += `; Max-Age=${Math.floor(options.maxAge)}`
  if (options.expires) line += `; Expires=${options.expires.toUTCString()}`
  if (options.httpOnly) line += '; HttpOnly'
  if (options.sameSite) {
    const s = options.sameSite === true ? 'strict' : options.sameSite
    line += `; SameSite=${s.charAt(0).toUpperCase()}${s.slice(1)}`
  }
  if (options.secure) line += '; Secure'
  return line
}

interface CookieDocument { cookie: string }

/** createBrowserClient용 쿠키 어댑터 — document.cookie를 읽고 쓰되, 쓸 때 로그인 유지 표식을 반영한다 */
export function createBrowserCookieAdapter(doc: CookieDocument = document) {
  return {
    getAll: () => parseCookies(doc.cookie),
    setAll: (cookies: { name: string; value: string; options: AuthCookieOptions }[], _headers?: Record<string, string>) => {
      const remember = parseCookies(doc.cookie).find((c) => c.name === REMEMBER_COOKIE)?.value
      for (const { name, value, options } of cookies) {
        doc.cookie = serializeCookie(name, value, adjustAuthCookieOptions(options, remember))
      }
    },
  }
}

/** 로그인 직전에 호출 — 이번 로그인의 "로그인 유지" 선택을 표식 쿠키로 남긴다(표식 자체는 1년 유지) */
export function setRememberChoice(remember: boolean, doc: CookieDocument = document): void {
  const https = typeof location !== 'undefined' && location.protocol === 'https:'
  doc.cookie = serializeCookie(REMEMBER_COOKIE, remember ? '1' : '0', {
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
    sameSite: 'lax',
    secure: https,
  })
}
