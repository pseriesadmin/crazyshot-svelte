// CMS 로그인 보호 — 반복 실패 제한 + 새 환경 로그인 판별 (Migration #762, 2026-10-24 권한 감사 3번)
// · 실패 기록은 이메일 해시로만 저장한다(원문 이메일·비밀번호 미저장). 조회·기록 오류는 로그인 자체를 막지 않는다(fail-open — 관리자가 장애로 잠기는 것 방지).
// · 제한(15분 안): ① 같은 이메일+같은 접속지 5회 실패 ② 같은 접속지 20회 실패 ③ 같은 이메일 전체 30회 실패(여러 접속지에서 분산 대입) → 로그인 시도를 서버에서 거절(인증 서버를 호출하지 않는다).
//   이메일 단독 5회로 잠그지 않는 이유: 공격자가 남의 관리자 이메일로 5번 틀려 정상 관리자를 잠그는 것(계정 잠금 DoS, sp3 M1)을 막기 위해 — 정상 관리자는 다른 접속지에서 계속 로그인할 수 있다.
import { createHash, createHmac } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export const LOGIN_FAIL_WINDOW_MS = 15 * 60 * 1000
export const LOGIN_FAIL_MAX_PER_EMAIL_IP = 5
export const LOGIN_FAIL_MAX_PER_EMAIL = 30
export const LOGIN_FAIL_MAX_PER_IP = 20
export const LOGIN_BLOCKED_MESSAGE = '로그인 시도가 너무 많아요. 15분 후 다시 시도해주세요.'

/** 이메일 해시 — salt(서버 비밀값)를 주면 HMAC 이라 후보 이메일을 대입해 역추적할 수 없다(sp3 m2). 없으면 단순 SHA-256(테스트·호환용) */
export function hashLoginEmail(email: string, salt = ''): string {
  const normalized = email.trim().toLowerCase()
  return salt ? createHmac('sha256', salt).update(normalized).digest('hex') : createHash('sha256').update(normalized).digest('hex')
}

/** 접속지를 얻지 못했을 때의 키 — 이 값이면 접속지 기준 제한을 적용하지 않는다(전원이 한 버킷에 묶여 함께 잠기는 것 방지, sp3 m1) */
export const UNKNOWN_IP = 'unknown'

async function countSince(admin: SupabaseClient, filters: Partial<Record<'email_hash' | 'ip_address', string>>): Promise<number> {
  const since = new Date(Date.now() - LOGIN_FAIL_WINDOW_MS).toISOString()
  let query = admin.from('cms_login_failures').select('id', { count: 'exact', head: true })
  if (filters.email_hash !== undefined) query = query.eq('email_hash', filters.email_hash)
  if (filters.ip_address !== undefined) query = query.eq('ip_address', filters.ip_address)
  const { count, error } = await query.gte('created_at', since)
  if (error) throw new Error(error.message)
  return count ?? 0
}

/** 로그인 시도를 막아야 하는가 — 조회 오류 시 false(fail-open) */
export async function isLoginBlocked(admin: SupabaseClient, emailHash: string, ip: string): Promise<boolean> {
  try {
    if (ip !== UNKNOWN_IP) {
      if ((await countSince(admin, { email_hash: emailHash, ip_address: ip })) >= LOGIN_FAIL_MAX_PER_EMAIL_IP) return true
      if ((await countSince(admin, { ip_address: ip })) >= LOGIN_FAIL_MAX_PER_IP) return true
    }
    if ((await countSince(admin, { email_hash: emailHash })) >= LOGIN_FAIL_MAX_PER_EMAIL) return true
    return false
  } catch (err) {
    console.error('[cmsLoginGuard] 실패 횟수 조회 오류:', err instanceof Error ? err.message : 'unknown')
    return false
  }
}

export async function recordLoginFailure(admin: SupabaseClient, emailHash: string, ip: string): Promise<void> {
  try {
    const { error } = await admin.from('cms_login_failures').insert({ email_hash: emailHash, ip_address: ip })
    if (error) console.error('[cmsLoginGuard] 실패 기록 오류:', error.message)
    // 하루 지난 기록 정리(표가 커지지 않게)
    await admin.from('cms_login_failures').delete().lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
  } catch {
    /* 기록 실패는 무시 */
  }
}

export async function clearLoginFailures(admin: SupabaseClient, emailHash: string): Promise<void> {
  try {
    await admin.from('cms_login_failures').delete().eq('email_hash', emailHash)
  } catch {
    /* 정리 실패는 무시 */
  }
}

/** 접속지 정규화 — x-forwarded-for 는 "클라이언트, 프록시..." 형태라 첫 값(클라이언트)만 비교한다(프록시 체인 차이로 인한 오탐 방지, sp3 m3) */
export function normalizeLoginIp(raw: string | null | undefined): string {
  return (raw ?? '').split(',')[0].trim()
}

/** 브라우저 정규화 — 버전 숫자를 지워 같은 브라우저의 업데이트를 같은 환경으로 본다 */
export function normalizeLoginUserAgent(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\d+(\.\d+)*/g, '').replace(/\s+/g, ' ').trim()
}

/** 이전 로그인 기록이 있는데 같은 접속지+브라우저 조합이 없으면 "새 환경"(첫 로그인은 새 환경으로 보지 않는다) */
export function isNewLoginEnvironment(prev: Array<{ ip_address: string | null; user_agent: string | null }>, ip: string, userAgent: string): boolean {
  if (prev.length === 0) return false
  const nip = normalizeLoginIp(ip)
  const nua = normalizeLoginUserAgent(userAgent)
  return !prev.some((p) => normalizeLoginIp(p.ip_address) === nip && normalizeLoginUserAgent(p.user_agent) === nua)
}
