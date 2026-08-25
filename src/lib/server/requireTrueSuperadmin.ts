import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchCmsProfileByAuthId } from './cmsProfile'
import { ROLE_LEVEL, getRoleLevel, hasSettingsAccess } from '$lib/utils/cmsPermissions'

/**
 * 마스터(superadmin) 전용 게이트 — CVE급 취약점 수정(2026-08-25).
 *
 * 기존 `requireSuperadmin()`(list `+page.server.ts`)이라는 이름의 헬퍼는 실제로는
 * `hasSettingsAccess()`(manager 이상, level>=50)만 검사해 manager 등급 관리자도 통과시켰다.
 * 이 함수는 그 이름이 원래 의도했던 동작 — 호출자가 **정확히** superadmin(level===100)인지
 * — 만 검사한다. manager(level 50)는 통과하지 못한다.
 *
 * 이 게이트는 "조작 대상(target) 계정이 superadmin일 때만" 발동해야 한다 — 대상이
 * superadmin이 아닌 일반 케이스(예: manager가 partner 계정을 관리)에서는 여전히
 * `hasSettingsAccess()` 기반 manager+ 게이트로 충분하다. 아래 `requireAccountMutationAccess`가
 * 그 분기를 담당한다.
 */
export async function requireTrueSuperadmin(
  locals: App.Locals,
  admin: SupabaseClient
): Promise<string | null> {
  const { session } = await locals.safeGetSession()
  if (!session) return '인증이 필요합니다.'

  const profile = await fetchCmsProfileByAuthId(admin, session.user.id)
  if (getRoleLevel(profile?.cms_role ?? '') !== ROLE_LEVEL.superadmin) {
    return '이 작업은 마스터(superadmin) 계정만 실행할 수 있습니다.'
  }
  return null
}

/**
 * CMS 관리자 계정 목록(`/cms/accounts/list`) 계정 관리 액션
 * (updateRole/toggleConcurrent/toggleSession/toggleSuspend/delete) 공용 게이트.
 *
 * 조작 대상(target) 계정의 **현재** cms_role을 먼저 조회해 분기한다:
 *   - target이 superadmin  → 호출자도 실제 superadmin이어야 통과(requireTrueSuperadmin)
 *   - target이 superadmin 아님 → 기존 manager+ 게이트(hasSettingsAccess)로 충분
 *
 * 즉 이 게이트는 "대상이 superadmin일 때만" 엄격 검사가 발동하는 오버레이이며, manager가
 * partner/manager 대상 계정을 관리하는 기존 정상 시나리오는 그대로 동작한다.
 */
export async function requireAccountMutationAccess(
  locals: App.Locals,
  admin: SupabaseClient,
  targetUserId: string
): Promise<string | null> {
  const targetProfile = await fetchCmsProfileByAuthId(admin, targetUserId)
  if (targetProfile?.cms_role === 'superadmin') {
    return requireTrueSuperadmin(locals, admin)
  }

  const { session } = await locals.safeGetSession()
  if (!session) return '인증이 필요합니다.'

  const callerProfile = await fetchCmsProfileByAuthId(admin, session.user.id)
  if (!hasSettingsAccess(callerProfile?.cms_role ?? '')) return '권한이 없습니다.'
  return null
}

/**
 * "마지막 남은 마스터(superadmin) 보호" 가드 — Q4 확정, Stage 7(EC-3).
 *
 * `requireTrueSuperadmin`/`requireAccountMutationAccess` 통과 **이후** 지점에서 호출한다
 * (호출자가 이미 superadmin임이 확인된 상태). 대상(target) 계정이 현재 superadmin이 아니면
 * 즉시 통과(null)한다 — 이 가드는 오직 "superadmin을 강등(updateRole)하거나 삭제(delete)하는
 * 시도가, 시스템에 superadmin이 정확히 1명만 남은 상태에서 발생했는가"만 검사한다.
 *
 * 과잉설계 방지 — toggleSuspend/toggleConcurrent/toggleSession처럼 cms_role 자체를 바꾸지
 * 않는 액션에는 적용하지 않는다(EC-3 요구사항 그대로).
 */
export async function requireNotLastSuperadmin(
  admin: SupabaseClient,
  targetUserId: string
): Promise<string | null> {
  const targetProfile = await fetchCmsProfileByAuthId(admin, targetUserId)
  if (targetProfile?.cms_role !== 'superadmin') return null

  const { count } = await admin
    .from('user_profiles')
    .select('id', { count: 'exact', head: true })
    .eq('cms_role', 'superadmin')

  if ((count ?? 0) <= 1) {
    return '마지막 남은 마스터(superadmin) 계정은 강등하거나 삭제할 수 없습니다.'
  }
  return null
}
