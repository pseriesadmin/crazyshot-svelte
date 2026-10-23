import { timingSafeEqual } from 'node:crypto'

/**
 * 문자열 상수시간 비교 — 서명·토큰·해시 검증용(보안 베이스라인 B-3, 2026-10-20).
 * `===` 는 첫 불일치에서 즉시 반환해 응답시간 차이로 값을 추정하는 타이밍 공격 여지가 있다.
 * - 길이가 다르면 timingSafeEqual 이 예외를 던지므로 먼저 false 처리(길이 자체는 비밀이 아님: HMAC 출력 길이는 고정)
 * - 빈 문자열 둘은 "서명 없음"을 일치로 오인하지 않도록 false
 */
export function safeEqualString(a: string, b: string): boolean {
  if (!a || !b) return false
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}
