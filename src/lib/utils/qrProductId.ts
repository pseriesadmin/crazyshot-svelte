/** QR 스캔 결과에서 상품 식별자(UUID 또는 품번) 추출
 * QR-CONTENT-1: 신규 QR은 품번 원문 텍스트. 기존 URL 방식 QR 하위호환 유지.
 */
export function extractProductId(raw: string): string | null {
  const text = raw.trim()
  // 기존 URL: /qr/product/{UUID} — UUID 추출
  const uuidMatch = text.match(/\/qr\/product\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
  if (uuidMatch?.[1]) return uuidMatch[1]
  // 기존 URL: /qr/product/{product_code} — URL 내 코드 추출
  const codeInUrlMatch = text.match(/\/qr\/product\/([A-Z0-9\-]{3,30})$/i)
  if (codeInUrlMatch?.[1]) return codeInUrlMatch[1]
  // 신규 (QR-CONTENT-1): URL 패턴이 아니면 원문 자체를 품번으로 취급
  if (!text.includes('://') && !text.startsWith('/')) {
    return text || null
  }
  return null
}

/** QR 스캔 결과에서 회원코드(member_code) 추출
 * 회원 QR 페이로드는 `/qr/member/{member_code}` 경로형 문자열로 고정 — 상품코드와 형식이
 * 겹치는(CS+타입코드+년월+순번) 원문 텍스트 그대로는 사용하지 않는다. 이 형식이면
 * extractProductId()는 이미 null을 반환하므로(마지막 분기가 '/'로 시작하지 않는 텍스트만
 * 상품코드로 인정) 두 함수가 서로 겹치지 않게 안전하게 분리된다 — extractProductId() 수정 불필요.
 */
export function extractMemberCode(raw: string): string | null {
  const text = raw.trim()
  const match = text.match(/^\/qr\/member\/(.+)$/)
  return match?.[1] || null
}

/** 스캔된 상품 식별자가 특정 예약의 상품(product_id 또는 product_code)과 일치하는지 검증
 * products.md QR-CASE-1 원칙과 동일하게 대소문자 무시 비교 (year_month='all' 채번 시
 * 소문자가 섞이는 사례 대응).
 */
export function isProductMatch(
  scannedId: string,
  row: { product_id: string; product_code: string | null },
): boolean {
  const scanned = scannedId.trim().toLowerCase()
  if (!scanned) return false
  if (row.product_id && row.product_id.trim().toLowerCase() === scanned) return true
  if (row.product_code && row.product_code.trim().toLowerCase() === scanned) return true
  return false
}
