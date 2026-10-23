// 관리자 비밀번호 복구 링크 — 휴대폰 인증번호 해시 (2026-10-23)
// DB(admin_password_recovery_tokens.otp_code)에는 원문 대신 이 해시만 저장한다.
// 서버 비밀키(HMAC)를 섞어, DB를 읽을 수 있는 사람도 6자리 숫자를 오프라인으로 대입해 알아낼 수 없게 한다.
import { createHmac, timingSafeEqual } from 'node:crypto'

export function hashRecoveryOtp(tokenId: string, code: string, secret: string): string {
  return createHmac('sha256', secret).update(`${tokenId}:${code}`).digest('hex')
}

/** 저장된 해시와 입력 번호를 상수 시간으로 비교한다(예전 원문 저장값·깨진 값은 항상 불일치) */
export function recoveryOtpMatches(tokenId: string, code: string, storedHash: string, secret: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(storedHash)) return false
  const a = Buffer.from(hashRecoveryOtp(tokenId, code, secret), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}
