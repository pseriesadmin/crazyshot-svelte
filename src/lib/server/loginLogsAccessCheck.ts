// src/lib/server/loginLogsAccessCheck.ts
// 접속로그 조회 권한 판정 로직
// "본인 자신 또는 manager+ 만 조회 가능" — partner가 타인 로그 조회 시 false 반환
import { getRoleLevel } from '$lib/utils/cmsPermissions'

/**
 * 접속로그 조회 허용 여부를 반환한다.
 *
 * @param viewerRole   조회를 요청하는 관리자의 cms_role
 * @param viewerUserId 조회를 요청하는 관리자의 auth user_id
 * @param targetUserId 로그를 조회할 대상 계정의 user_id
 * @returns true → 조회 허용 / false → 403 처리
 */
export function canViewLoginLogs(
  viewerRole: string,
  viewerUserId: string,
  targetUserId: string
): boolean {
  // manager(50) 이상은 모든 계정의 접속로그 조회 가능
  if (getRoleLevel(viewerRole) >= getRoleLevel('manager')) return true
  // partner(10) 이하는 본인의 로그만 조회 가능
  return viewerUserId === targetUserId
}
