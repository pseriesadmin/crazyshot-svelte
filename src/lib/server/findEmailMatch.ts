// 아이디 찾기 — 이름·휴대폰으로 찾은 프로필이 "알려줘도 되는 일반 고객 계정"인지 판정하는 공용 규칙.
// 인증번호 발송(find-email/send-otp)과 이메일 확인(find-email)이 같은 규칙을 쓴다(한쪽만 걸러 우회되는 것 방지).
import { normalizeLegacyName } from '$lib/server/legacyClaim'

export interface FindEmailProfileRow {
  user_id: string
  full_name: string | null
  cms_role: string | null
  withdrawal_status: string | null
  email: string | null
}

const PURGED_EMAIL_DOMAIN = '@purged.crazyshot.kr'

/** 같은 번호의 후보가 정확히 1건이고, 관리자·탈회 완전삭제·익명화 계정이 아니며, 이름이 같을 때만 true(공백·대소문자 무시) */
export function pickFindableProfile(rows: FindEmailProfileRow[] | null | undefined, name: string): FindEmailProfileRow | null {
  if (!rows || rows.length !== 1) return null
  const p = rows[0]
  if (p.cms_role) return null
  if (p.withdrawal_status === 'purged') return null
  if ((p.email ?? '').toLowerCase().endsWith(PURGED_EMAIL_DOMAIN)) return null
  if (!p.full_name || normalizeLegacyName(p.full_name) !== normalizeLegacyName(name)) return null
  return p
}
