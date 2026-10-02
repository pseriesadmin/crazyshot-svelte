/**
 * 빠른답변 CTA 버튼 링크 검증 — 클라이언트(CannedResponsePanel)와 서버(buildCannedCtaPayload)가 공유.
 * 허용: http(s):// 절대 URL 또는 사이트 내부 경로("/로 시작", "//"는 프로토콜 상대 URL이라 제외).
 * 관리자가 입력한 값이 고객 화면에서 window.open으로 열리므로 javascript: 등 다른 스킴은 막는다.
 */
export function isValidCtaUrl(url: string | null | undefined): boolean {
  if (!url) return false
  const v = url.trim()
  if (!v) return false
  if (/^https?:\/\/\S+$/i.test(v)) return true
  return /^\/(?!\/)\S*$/.test(v)
}
