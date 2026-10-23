// 관리자 계정 "퇴직 처리" — 업무 이력이 남아 있어 계정을 완전히 지울 수 없을 때의 삭제 방식 (2026-10-23)
//
// 배경: 계약서 양식·대여 처리 기록·쿠폰 배포·상담 답변 등이 계정(auth.users)을 참조하고, 그 참조는 삭제를 막도록 설정돼 있다(이력 보존).
//       그래서 이력이 있는 관리자는 auth 계정을 지우면 "Database error deleting user"로 실패한다.
// 처리: 계정은 남기되 사람은 사라진 상태로 만든다 — 이력 행은 그대로 두고(참조 유지) 화면에는 '[삭제된 계정]'으로 보인다.
//   0) 대상 확인: 관리자(cms_role 보유) 계정만 — 고객 계정은 이 경로로 익명화·차단하지 않는다(보안 검수 SEC-A2)
//   1) 로그인 계정: 이메일을 익명 값으로 바꿔 원래 이메일을 재사용할 수 있게 하고, 비밀번호를 무작위로 덮고, 사실상 영구 차단(ban)
//   2) 프로필: 관리자 역할 제거(CMS 접근·목록 노출 종료)·이름·이메일·휴대폰 익명화·삭제 표시(deleted_at) — 영향 행이 없으면 실패
//   3) 메뉴 권한 행 정리(fail-soft)
// 순서 이유: 1)이 실패하면 아무것도 바뀌지 않고 여전히 관리자 목록에 남아 다시 삭제할 수 있다. 역할 제거를 마지막 필수 단계로 두면
//   "관리자 역할은 사라졌는데 로그인 계정은 살아 있어 목록에서도 못 찾는" 상태가 생기지 않는다(2)가 실패하면 로그인은 이미 차단된 상태로 목록에 남음).
// 같은 호출을 다시 해도 결과가 같다(멱등) — 중간에 실패해도 다시 삭제를 누르면 이어서 끝난다.
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

/** 탈회 완전삭제 때 쓰는 익명 이메일 도메인과 같은 값 — 비밀번호 찾기 등이 이 도메인을 제외 대상으로 본다 */
export const RETIRED_EMAIL_DOMAIN = '@purged.crazyshot.kr'
export const RETIRED_NAME = '[삭제된 계정]'
/** 약 100년 — Supabase ban_duration은 기간 문자열만 받는다 */
const BAN_DURATION = '876000h'

export function retiredEmailFor(userId: string): string {
  return `deleted-${userId}${RETIRED_EMAIL_DOMAIN}`
}

/**
 * auth.admin.deleteUser가 DB 제약(이력 참조)으로 실패했는지 — 그 경우에만 퇴직 처리로 넘어간다.
 * 인증 서버는 같은 제약 위반을 상황에 따라 "Database error deleting user" 문구 또는 문구 없는 500으로 돌려준다(실측) — 둘 다 DB 쪽 거절로 본다.
 * 네트워크 오류(상태 코드 없음)·계정 없음(404) 등 그 밖의 오류는 퇴직 처리하지 않고 그대로 실패시킨다.
 */
export function isAuthDbDeleteError(err: { message?: string | null; status?: number | null } | null | undefined): boolean {
  if (!err) return false
  if (hasDbErrorMessage(err)) return true
  return err.status === 500
}

/** 문구에 "database error"가 있는 확정적인 DB 거절인가 — 문구 없는 500은 일시 장애일 수 있어 호출 쪽이 한 번 더 시도한 뒤 판단한다(보안 검수 SEC-A1) */
export function hasDbErrorMessage(err: { message?: string | null } | null | undefined): boolean {
  return typeof err?.message === 'string' && err.message.toLowerCase().includes('database error')
}

export async function retireAdminAccount(
  admin: SupabaseClient,
  userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = retiredEmailFor(userId)

  // 0) 관리자 계정만 — 대상이 일반 고객이면 거절(호출 쪽 검사와 별개로 한 번 더 막는다)
  const { data: target, error: targetErr } = await admin.from('user_profiles').select('id, cms_role').eq('id', userId).maybeSingle()
  if (targetErr) {
    console.error('[retireAdminAccount] 대상 조회 실패:', targetErr.message)
    return { ok: false, error: '계정 확인에 실패했습니다. 잠시 후 다시 시도해주세요.' }
  }
  if (!target || !(target as { cms_role: string | null }).cms_role) {
    return { ok: false, error: '관리자 계정만 삭제할 수 있습니다.' }
  }

  // 1) 로그인 계정 — 이메일 익명화·무작위 비밀번호·영구 차단
  const { error: authErr } = await admin.auth.admin.updateUserById(userId, {
    email,
    email_confirm: true,
    password: `${randomUUID()}${randomUUID()}`,
    ban_duration: BAN_DURATION,
  })
  if (authErr) {
    console.error('[retireAdminAccount] 로그인 계정 정리 실패:', authErr.message)
    return { ok: false, error: '로그인 차단 처리에 실패했습니다. 잠시 후 다시 삭제를 눌러주세요.' }
  }

  // 2) 프로필 — 관리자 역할 제거와 익명화. 갱신된 행이 없으면 실패로 본다(프로필 키 구조가 달라 0행이 갱신돼도 성공처럼 보이는 것 방지)
  const { data: updated, error: profileErr } = await admin
    .from('user_profiles')
    .update({
      cms_role: null,
      full_name: RETIRED_NAME,
      email,
      phone: null,
      blacklisted: false,
      deleted_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .not('cms_role', 'is', null)
    .select('id')
  if (profileErr || !updated || updated.length === 0) {
    console.error('[retireAdminAccount] 프로필 정리 실패:', profileErr?.message ?? '갱신된 행 없음')
    return { ok: false, error: '계정 정리에 실패했습니다. 로그인은 이미 차단됐습니다. 다시 삭제를 눌러 이어서 진행해주세요.' }
  }

  // 3) 메뉴 권한 행 정리 — 이력이 아니라 이 계정만의 설정이라 지워도 된다(실패해도 삭제 결과에는 영향 없음)
  try {
    const { error } = await admin.from('cms_menu_permissions').delete().eq('user_id', userId)
    if (error) console.error('[retireAdminAccount] 메뉴 권한 정리 실패:', error.message)
  } catch (err) {
    console.error('[retireAdminAccount] 메뉴 권한 정리 예외:', err instanceof Error ? err.message : 'unknown')
  }

  return { ok: true }
}
