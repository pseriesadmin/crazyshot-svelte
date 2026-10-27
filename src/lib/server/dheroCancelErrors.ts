// src/lib/server/dheroCancelErrors.ts
// 두발히어로 취소 API 412 응답 메시지 판별 헬퍼 — 순수 함수, 단위 시험 가능
// 안내서(2026.06.22) §5·§취소불가 메시지 정의 참조

/** 안내서에 정의된 "이미 취소된 배송" 메시지 (dhero-delivery-api.md §5) */
const DHERO_ALREADY_CANCELED_MSG = '이미 취소된 배송입니다.'

/**
 * 두발히어로 취소 API 412 응답이 "이미 취소된 배송입니다." 케이스인지 판별한다.
 *
 * fail-safe 원칙: 메시지가 명확히 '이미 취소된 배송입니다.'를 포함할 때만 true.
 * - 빈 메시지: false → (b) 취소 불가 경로로 처리 (모르면 실패 쪽이 안전)
 * - 다른 412 메시지(배송 출발·완료 등): false → (b)로 처리
 * - 412 아닌 상태코드: false
 *
 * 호출처: /api/cms/reservations/[id]/dhero/cancel/+server.ts
 */
export function isAlreadyCanceledError(e: { statusCode: number; message: string }): boolean {
  return e.statusCode === 412 && e.message.includes(DHERO_ALREADY_CANCELED_MSG)
}
