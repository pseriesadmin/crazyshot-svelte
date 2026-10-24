// 비밀번호 재설정(문자 인증번호) — 서버 공용 규칙 (2026-10-23)
// 흐름: send-otp(이메일+휴대폰이 같은 계정일 때만 문자 발송) → verify-otp(인증번호 확인) → complete(새 비밀번호 설정)
// 인증번호는 원문 저장 없이 해시로만 보관한다(테이블: password_reset_otps, Migration 747).
import { createHash, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { escapeLikePattern } from '$lib/server/escapeLikePattern'

/** 인증번호 유효시간 */
export const OTP_TTL_MS = 3 * 60 * 1000
/** 인증번호 확인 후 비밀번호를 설정할 수 있는 시간 */
export const VERIFIED_WINDOW_MS = 10 * 60 * 1000
/** 인증번호 한 건당 틀린 입력 허용 횟수 */
export const MAX_ATTEMPTS = 5
/** 같은 번호로 다시 보낼 수 있는 최소 간격 */
export const RESEND_COOLDOWN_MS = 60 * 1000
/** 같은 번호로 1시간 안에 보낼 수 있는 최대 횟수(문자 비용·스팸 방지) */
export const MAX_SENDS_PER_HOUR = 5

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const PHONE_RE = /^010\d{8}$/
/** 탈회 완전삭제 시 이메일이 이 도메인의 익명 값으로 바뀐다(service-operations.md §16 ④) */
const PURGED_EMAIL_DOMAIN = '@purged.crazyshot.kr'

export function normalizePhone(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/[^0-9]/g, '') : ''
}

export function normalizeEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

export function hashOtpCode(id: string, code: string): string {
  return createHash('sha256').update(`${id}:${code}`).digest('hex')
}

export function otpCodeMatches(id: string, code: string, storedHash: string): boolean {
  const a = Buffer.from(hashOtpCode(id, code), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * 이메일 + 휴대폰 번호가 같은 일반 고객 계정을 찾는다.
 * 제외: 관리자(CMS) 계정(문자만으로 관리자 비밀번호를 바꿀 수 없게 — 계정 관리의 전용 복구 흐름만 허용),
 *       삭제·탈회 완전삭제·익명화 계정.
 */
export async function findResetTarget(admin: SupabaseClient, email: string, phone: string): Promise<{ userId: string } | null> {
  const found = await lookupResetAccount(admin, email, phone)
  return found && !found.isAdmin ? { userId: found.userId } : null
}

/**
 * 이메일 + 휴대폰 번호가 일치하는 계정이 "관리자(CMS) 계정"인지 확인한다 — 로그인 화면이 "관리자 계정은 CMS에서 수정하세요" 안내를 띄우는 용도.
 * 이메일과 번호가 둘 다 일치할 때만 true(한쪽만 아는 사람에게는 관리자 여부가 드러나지 않는다).
 */
export async function isAdminResetMatch(admin: SupabaseClient, email: string, phone: string): Promise<boolean> {
  const found = await lookupResetAccount(admin, email, phone)
  return !!found?.isAdmin
}

interface ProfileMatchRow {
  user_id: string
  cms_role: string | null
  withdrawal_status: string | null
  deleted_at: string | null
  email: string | null
}

/** 휴대폰 번호가 같고 프로필 이메일이 비어 있는 계정 중, 로그인 계정(auth) 이메일이 입력 이메일과 같은 계정 */
async function findByAuthEmail(admin: SupabaseClient, email: string, phones: string[]): Promise<ProfileMatchRow[]> {
  try {
    const { data, error } = await admin
      .from('user_profiles')
      .select('user_id, cms_role, withdrawal_status, deleted_at, email')
      .in('phone', phones)
      .limit(5)
    if (error) return []
    const candidates = ((data ?? []) as ProfileMatchRow[]).filter((r) => r.user_id && !(r.email ?? '').trim())
    const matched: ProfileMatchRow[] = []
    for (const c of candidates) {
      const { data: au } = await admin.auth.admin.getUserById(c.user_id)
      const authEmail = (au?.user?.email ?? '').trim().toLowerCase()
      if (authEmail && authEmail === email.trim().toLowerCase()) matched.push({ ...c, email: au?.user?.email ?? null })
    }
    return matched
  } catch {
    return []
  }
}

async function lookupResetAccount(admin: SupabaseClient, email: string, phone: string): Promise<{ userId: string; isAdmin: boolean } | null> {
  // 프로필의 휴대폰 번호는 "01012345678"과 "010-1234-5678" 두 형식으로 섞여 저장돼 있다 — 둘 다 같은 번호로 본다
  const hyphenated = `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`
  const { data, error } = await admin
    .from('user_profiles')
    .select('user_id, cms_role, withdrawal_status, deleted_at, email')
    .ilike('email', escapeLikePattern(email))
    .in('phone', [phone, hyphenated])
    .limit(2)
  if (error) {
    console.error('[password-reset] 계정 조회 실패:', error.message)
    return null
  }
  let rows = (data ?? []) as ProfileMatchRow[]
  // 프로필 이메일이 비어 있어도 로그인 계정(auth) 이메일이 같으면 같은 계정으로 본다(2026-10-24) — 가입 때 프로필 이메일이 채워지지 않은 회원 구제
  if (rows.length === 0) rows = await findByAuthEmail(admin, email, [phone, hyphenated])
  // 같은 이메일·번호에 계정이 둘 이상이면 모호하므로 진행하지 않는다
  if (rows.length !== 1) return null
  const row = rows[0]
  if (!row.user_id) return null
  if (row.deleted_at || row.withdrawal_status === 'purged') return null
  if (!row.email || row.email.toLowerCase().endsWith(PURGED_EMAIL_DOMAIN)) return null
  return { userId: row.user_id, isAdmin: !!row.cms_role }
}
