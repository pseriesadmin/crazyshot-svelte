/** QR 스캔 결과에서 상품 식별자(UUID 또는 품번) 추출
 * QR-CONTENT-1: 신규 QR은 품번 원문 텍스트. 기존 URL 방식 QR 하위호환 유지.
 * 신버전 payload(`{product_code}|{category}`)는 `|` 앞부분만 반환해 하위호환 유지.
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
  // 신버전 payload: `{product_code}|{category}` — `|` 있으면 앞부분만 반환(하위호환)
  if (!text.includes('://') && !text.startsWith('/')) {
    const pipeIdx = text.indexOf('|')
    const code = pipeIdx >= 0 ? text.slice(0, pipeIdx) : text
    return code || null
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

/**
 * QR 스캔 결과에서 예약코드(reservation_code) 추출.
 * 실제 DB 형식 분석(Migration #316) 기반:
 *   - `CS{YYMM}{seq}` (예: CS2609001) — CS 직후 숫자만 이어짐 (상품코드는 알파벳 카테고리 포함)
 *   - `CZ-{id}` (예: CZ-00001)       — 폴백 fallback ID
 * Stage 0 불일치: 플랜 제안 regex(`/^CZ-\d{8}-\d{5}$/i`)는 실제 형식과 맞지 않아 사용 안 함.
 */
export function extractReservationCode(raw: string): string | null {
  const text = raw.trim()
  // CZ- 접두어 폴백 (CZ-{id 1~20자})
  if (/^CZ-.{1,20}$/i.test(text)) return text
  // CS + 숫자만 이어지는 예약코드 (CS{YYMM}{seq}) — 상품코드는 CS 직후 알파벳 카테고리가 반드시 섞임
  if (/^CS\d{4,}$/i.test(text)) return text
  return null
}

/** QR 페이로드 타입 판별 결과 */
export type QrPayloadResult =
  | { type: 'product'; value: string }
  | { type: 'member'; value: string }
  | { type: 'reservation'; value: string }
  | { type: 'unknown'; value: string }

/**
 * QR 스캔 결과를 받아 타입(product/member/reservation/unknown)을 판별.
 * 모바일 QR 스캐너의 단일 진입점으로 활용 — 각 타입별 라우팅을 caller가 처리.
 *
 * 판별 순서 (단락-전진 fallthrough):
 *   1. `/qr/member/` 접두어 → member
 *   2. `|` 포함 → 신버전 상품 payload (`{product_code}|{category}`)
 *   3. 예약코드 패턴 일치 → reservation
 *   4. URL 아닌 원문 텍스트 → old product (레거시 QR 하위호환)
 *   5. 나머지 → unknown
 */
export function identifyQrPayload(raw: string): QrPayloadResult {
  const text = raw.trim()

  // 1. 회원 QR
  const memberCode = extractMemberCode(text)
  if (memberCode) return { type: 'member', value: memberCode }

  // 2. 신버전 상품 payload (pipe 포함)
  if (!text.includes('://') && !text.startsWith('/') && text.includes('|')) {
    const code = extractProductId(text)
    if (code) return { type: 'product', value: code }
  }

  // 3. 예약코드
  const resCode = extractReservationCode(text)
  if (resCode) return { type: 'reservation', value: resCode }

  // 4. 구버전 상품 QR (원문 품번 또는 URL 경로 형식)
  const productId = extractProductId(text)
  if (productId) return { type: 'product', value: productId }

  return { type: 'unknown', value: text }
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
