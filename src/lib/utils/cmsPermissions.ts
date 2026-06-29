/**
 * CMS 권한 레벨 정의 (숫자가 높을수록 상위 권한)
 *
 * 새 역할 추가 시: ROLE_LEVEL에 레벨 값만 추가
 * 경로 제한 추가 시: ROUTE_MIN_ROLE 배열에 항목 추가
 */
export const ROLE_LEVEL: Record<string, number> = {
  superadmin: 100,
  manager:    50,
  partner:    10,
}

/**
 * 경로별 최소 필요 역할 (prefix 매칭, 선언 순서대로 우선 적용)
 * 추후 메뉴 확장 시 이 배열에만 항목 추가
 */
const ROUTE_MIN_ROLE: [string, string][] = [
  ['/cms/accounts', 'manager'],
  // 확장 예시:
  // ['/cms/finance', 'superadmin'],
  // ['/cms/reports', 'manager'],
]

export function getRoleLevel(role: string): number {
  // eslint-disable-next-line security/detect-object-injection
  return Object.prototype.hasOwnProperty.call(ROLE_LEVEL, role) ? ROLE_LEVEL[role] : 0
}

/** 해당 경로에 접근할 수 있는 역할인지 확인 */
export function hasRouteAccess(role: string, pathname: string): boolean {
  const userLevel = getRoleLevel(role)
  for (const [route, minRole] of ROUTE_MIN_ROLE) {
    if (pathname.startsWith(route)) {
      return userLevel >= getRoleLevel(minRole)
    }
  }
  return true
}

/** 설정 메뉴(계정관리·계정목록) 접근 가능 여부 */
export function hasSettingsAccess(role: string): boolean {
  return getRoleLevel(role) >= getRoleLevel('manager')
}
