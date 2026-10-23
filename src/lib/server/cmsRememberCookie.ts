// CMS 로그인 유지 표식 쿠키(cms-remember) — 로그인 화면과 CMS 레이아웃이 같은 규칙을 쓴다 (2026-10-24)
// 표식이 없으면 CMS 레이아웃이 로그인을 끊는다. 수명은 실제 로그인 쿠키(@supabase/ssr 기본 400일)와 맞춘다 —
// 표식만 먼저 만료돼 로그인은 살아 있는데 로그아웃되는 일을 막는다.
export const CMS_REMEMBER_COOKIE = 'cms-remember'
export const CMS_REMEMBER_MAX_AGE = 60 * 60 * 24 * 400

/** remember=false(로그인 유지 안 함)이면 maxAge 없는 세션 쿠키, true면 400일 */
export function cmsRememberCookieOptions(remember: boolean) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: true,
    ...(remember ? { maxAge: CMS_REMEMBER_MAX_AGE } : {}),
  }
}
