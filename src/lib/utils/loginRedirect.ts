// 로그인 링크 — 지금 보던 화면을 redirect로 붙여, 로그인 성공 즉시 그 화면으로 돌아오게 한다 (2026-10-24)
// 로그인 화면(/auth/login)은 redirect 값을 safeReturnPath로 검증(내부 경로만 허용)해 사용한다.
// 홈(/)·인증 화면(/auth/*)에서는 붙이지 않는다 — 홈은 기본 도착지와 같고, 인증 화면끼리 돌려보내면 루프가 된다.
const LOGIN_PATH = '/auth/login'
const MAX_RETURN_LENGTH = 500

export function loginHref(pathname: string, search = ''): string {
  if (!pathname || pathname === '/' || pathname.startsWith('/auth/')) return LOGIN_PATH
  const back = pathname + search
  if (back.length > MAX_RETURN_LENGTH) return LOGIN_PATH
  return `${LOGIN_PATH}?redirect=${encodeURIComponent(back)}`
}
