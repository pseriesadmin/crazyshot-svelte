import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { hashRecoveryOtp, recoveryOtpMatches } from '$lib/server/recoveryOtp'

const SECRET = 'test-secret-key'

describe('관리자 복구 인증번호 해시', () => {
  it('64자리 16진수 해시이고 원문을 포함하지 않는다', () => {
    const h = hashRecoveryOtp('id-1', '123456', SECRET)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).not.toContain('123456')
  })
  it('같은 입력은 같은 해시, 링크(id)·비밀키·번호가 다르면 다른 해시', () => {
    const base = hashRecoveryOtp('id-1', '123456', SECRET)
    expect(hashRecoveryOtp('id-1', '123456', SECRET)).toBe(base)
    expect(hashRecoveryOtp('id-2', '123456', SECRET)).not.toBe(base)
    expect(hashRecoveryOtp('id-1', '123457', SECRET)).not.toBe(base)
    expect(hashRecoveryOtp('id-1', '123456', 'other')).not.toBe(base)
  })
  it('맞는 번호만 일치, 틀린 번호·빈 값·깨진 저장값은 불일치', () => {
    const h = hashRecoveryOtp('id-1', '123456', SECRET)
    expect(recoveryOtpMatches('id-1', '123456', h, SECRET)).toBe(true)
    expect(recoveryOtpMatches('id-1', '000000', h, SECRET)).toBe(false)
    expect(recoveryOtpMatches('id-1', '', h, SECRET)).toBe(false)
    expect(recoveryOtpMatches('id-1', '123456', '123456', SECRET)).toBe(false) // 예전 원문 저장값
    expect(recoveryOtpMatches('id-1', '123456', 'zz', SECRET)).toBe(false)
  })
})

describe('복구 로그인 서버 소스 점검', () => {
  const src = readFileSync('src/routes/cms/login/+page.server.ts', 'utf-8')
  it('인증번호를 원문으로 저장하거나 단순 비교하지 않는다', () => {
    expect(src).not.toMatch(/otp_code:\s*code\b/)
    expect(src).not.toMatch(/row\.otp_code\s*!==\s*code/)
    expect(src).toContain('recoveryOtpMatches')
    expect(src).toContain('hashRecoveryOtp')
  })
  it('카운터를 읽은 값 + 1 로 덮어쓰지 않고, 조회 오류를 "유효하지 않은 링크"로 뭉개지 않는다', () => {
    expect(src).not.toMatch(/match_attempts:\s*next\b/)
    expect(src).not.toMatch(/otp_attempts:\s*nextAttempts/)
    expect(src).toContain('bumpRecoveryCounter')
    expect(src).toContain('토큰 조회 실패')
  })
})
