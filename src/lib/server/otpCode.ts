import { randomInt } from 'node:crypto'

/**
 * 6자리 인증번호(OTP) 생성 — 암호학적 난수(CSPRNG) 사용.
 * Math.random() 은 예측 가능한 PRNG 라 인증번호·복구코드 용도로 쓰면 안 된다(보안 베이스라인 B-2, 2026-10-20).
 * 범위: 100000 ~ 999999 (앞자리 0 없음 — 기존 코드의 100000 + random*900000 과 동일 범위).
 */
export function generateOtpCode(): string {
  return String(randomInt(100000, 1000000))
}
