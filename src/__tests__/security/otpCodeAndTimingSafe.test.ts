import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateOtpCode } from '$lib/server/otpCode'
import { safeEqualString } from '$lib/server/timingSafeEqual'

/**
 * 보안 베이스라인 B-2 / B-3 (2026-10-20)
 *  B-2: OTP 인증번호는 예측 가능한 Math.random 이 아니라 암호학적 난수(crypto.randomInt)로 만든다.
 *  B-3: 서명·토큰 비교는 상수시간(crypto.timingSafeEqual) — 길이가 달라도 예외 없이 false.
 */
describe('generateOtpCode (B-2)', () => {
  it('항상 6자리 숫자 문자열(100000~999999)이다', () => {
    for (let i = 0; i < 500; i++) {
      const code = generateOtpCode()
      expect(code).toMatch(/^[1-9]\d{5}$/)
    }
  })

  it('암호학적 난수(randomInt)를 쓰고 Math.random 을 쓰지 않는다', () => {
    const rnd = vi.spyOn(Math, 'random')
    generateOtpCode()
    expect(rnd).not.toHaveBeenCalled()
    rnd.mockRestore()
  })

  it('값이 한 가지로 고정되지 않는다(분포 sanity)', () => {
    const set = new Set(Array.from({ length: 200 }, () => generateOtpCode()))
    expect(set.size).toBeGreaterThan(150)
  })
})

describe('safeEqualString (B-3)', () => {
  it('같은 문자열 true / 다른 문자열 false', () => {
    expect(safeEqualString('abc==', 'abc==')).toBe(true)
    expect(safeEqualString('abc==', 'abd==')).toBe(false)
  })
  it('길이가 달라도 예외 없이 false', () => {
    expect(safeEqualString('short', 'much-longer-value')).toBe(false)
    expect(safeEqualString('', 'x')).toBe(false)
  })
  it('빈 문자열 둘은 true 가 아니라 거부(서명 부재 오인 방지)', () => {
    expect(safeEqualString('', '')).toBe(false)
  })
  it('멀티바이트(한글)도 안전하게 비교', () => {
    expect(safeEqualString('인증', '인증')).toBe(true)
    expect(safeEqualString('인증', '인정')).toBe(false)
  })
})

describe('가드: 보안 값 생성·비교 소스 규칙 (재발 방지)', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
  const OTP_SITES = [
    'src/routes/api/profile/send-otp/+server.ts',
    'src/routes/api/auth/legacy-claim/send-otp/+server.ts',
    'src/routes/cms/login/+page.server.ts',
  ]
  it.each(OTP_SITES)('%s 는 OTP 를 generateOtpCode() 로 만들고 Math.random 을 쓰지 않는다', (p) => {
    const src = read(p)
    expect(src).toContain('generateOtpCode()')
    expect(src).not.toMatch(/Math\.random\(\)/)
  })

  it('토스 웹훅 서명 비교는 safeEqualString 을 쓰고 === 로 비교하지 않는다', () => {
    const src = read('src/routes/api/webhooks/toss/+server.ts')
    expect(src).toContain('safeEqualString(')
    expect(src).not.toMatch(/computed\s*===\s*signature/)
  })
})
