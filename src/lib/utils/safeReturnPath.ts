// 복귀 경로(returnTo) 검증 (2026-10-05) — 같은 사이트 내부 경로만 허용해 open redirect를 막는다.
// "/"로 시작하되 프로토콜 상대 URL("//evil.com")·백슬래시("/\evil.com")·개행/제어문자는 거부한다.
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null
  return raw
}
