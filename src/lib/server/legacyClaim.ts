// 기존 회원(레거시) 인증 — 조회 결과를 사유별로 구분하는 서버 헬퍼 (2026-10-23)
// 배경: 예전에는 어떤 이유로든 못 찾으면 같은 "확인 가능한 회원 정보가 없습니다."만 나와서, 이미 인증을 끝낸 고객이
//       다시 시도해도 이유를 알 수 없었다. 사유를 나눠 안내한다.
// 주의: 가입된 계정 여부는 "이름까지 일치할 때만" 알려 준다(전화번호만으로 가입 여부가 새어 나가지 않게).
import type { SupabaseClient } from '@supabase/supabase-js'

export type LegacyLookup =
  | { status: 'found'; member: Record<string, unknown> }
  /** 이미 기존 회원 인증을 끝낸 계정이 있음 → 로그인·비밀번호 찾기 안내 */
  | { status: 'already_claimed' }
  /** 같은 이름·전화번호로 이미 가입된 계정이 있음(기존 회원 인증이 아닌 일반 가입) → 로그인 안내 */
  | { status: 'already_registered' }
  | { status: 'not_found' }

/** 이름 비교용 정규화 — 모든 공백 제거 + 대문자(DB find_legacy_member 와 같은 기준) */
export function normalizeLegacyName(name: string): string {
  return name.replace(/\s/g, '').toUpperCase()
}

export async function lookupLegacyForClaim(admin: SupabaseClient, name: string, phone: string): Promise<LegacyLookup> {
  const { data: member, error } = await admin.rpc('find_legacy_member', { p_name: name, p_phone: phone })
  if (error) console.error('[legacy-claim] find_legacy_member RPC error:', error.message)
  if (member && typeof member === 'object') return { status: 'found', member: member as Record<string, unknown> }

  // 대기 목록에 없다 → 이미 같은 정보로 가입·인증된 계정인지 확인
  const { data: profile } = await admin
    .from('user_profiles')
    .select('full_name, legacy_claimed_at')
    .eq('phone', phone)
    .is('deleted_at', null)
    .maybeSingle()
  const p = profile as { full_name: string | null; legacy_claimed_at: string | null } | null
  if (p && p.full_name && normalizeLegacyName(p.full_name) === normalizeLegacyName(name)) {
    return p.legacy_claimed_at ? { status: 'already_claimed' } : { status: 'already_registered' }
  }
  return { status: 'not_found' }
}

const PW_MIN = 6
const PW_MAX = 72

/** 기존 회원 인증 직후 비밀번호 설정 입력 검증 — 6~72자, 영문·숫자·특수문자(ASCII)만(로그인 화면 입력 표준과 같은 규칙) */
export function validateNewPassword(pw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof pw !== 'string') return { ok: false, error: '비밀번호를 입력해 주세요.' }
  if (pw.length < PW_MIN) return { ok: false, error: `비밀번호는 ${PW_MIN}자 이상이어야 해요.` }
  if (pw.length > PW_MAX) return { ok: false, error: `비밀번호는 ${PW_MAX}자 이하여야 해요.` }
  if (/[^\x21-\x7E]/.test(pw)) return { ok: false, error: '비밀번호는 영문·숫자·특수문자만 사용할 수 있어요.' }
  return { ok: true, value: pw }
}
