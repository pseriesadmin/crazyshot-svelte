/**
 * contentHash.ts — 계약서 콘텐츠 SHA-256 해시 유틸
 *
 * Phase 8-A: 서명 제출 시점에 서명 대상 콘텐츠를 해시해 contract_signings.content_hash에 저장.
 * Web Crypto API(crypto.subtle) 사용 — Node.js 18+ 및 브라우저 양쪽에서 추가 의존성 없이 동작.
 *
 * ⚠️ SMS/OTP 재인증은 v1 범위 밖 — 이 해시는 "서명 당시 어떤 콘텐츠에 서명했는가"를
 *    암호학적으로 증명하는 용도이지, 신원 재확인 수단이 아님(과장 표현 금지, Phase 8 리스크 §보안).
 */

/**
 * 임의 콘텐츠(JSON 직렬화 가능)의 SHA-256 해시를 16진수 문자열로 반환.
 *
 * @param content - 해시할 콘텐츠 (content_blocks 배열, canvas_document 객체 등)
 * @returns 64자 16진수 SHA-256 해시 문자열
 */
export async function computeContentHash(content: unknown): Promise<string> {
  const text   = JSON.stringify(content)
  const buffer = new TextEncoder().encode(text)

  // Node.js 18+ 전역 crypto.subtle 사용 (추가 import 없음)
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const hashArray  = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}
