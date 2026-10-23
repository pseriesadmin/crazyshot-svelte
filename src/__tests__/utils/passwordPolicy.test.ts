import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { PASSWORD_MIN, PASSWORD_MAX, sanitizePasswordInput, validateNewPasswordInput } from '$lib/utils/passwordPolicy'
import { validateNewPassword } from '$lib/server/legacyClaim'

describe('비밀번호 입력 규칙(클라이언트) — 메인 비밀번호 찾기(서버)와 같은 규칙', () => {
  it('상수: 6~72자', () => {
    expect(PASSWORD_MIN).toBe(6)
    expect(PASSWORD_MAX).toBe(72)
  })

  it('입력 정리: 한글·공백·이모지를 제거하고 제거 여부를 알려준다', () => {
    expect(sanitizePasswordInput('abc123!')).toEqual({ value: 'abc123!', removed: false })
    expect(sanitizePasswordInput('한글abc')).toEqual({ value: 'abc', removed: true })
    expect(sanitizePasswordInput('a b c')).toEqual({ value: 'abc', removed: true })
    expect(sanitizePasswordInput('pw😀12')).toEqual({ value: 'pw12', removed: true })
    expect(sanitizePasswordInput('')).toEqual({ value: '', removed: false })
  })

  it('검증: 빈 값·짧음·김·일치하지 않음·허용되지 않는 문자를 각각 거절한다', () => {
    expect(validateNewPasswordInput('', '')).not.toBeNull()
    expect(validateNewPasswordInput('abc12', 'abc12')).toContain('6자')
    expect(validateNewPasswordInput('a'.repeat(73), 'a'.repeat(73))).toContain('72자')
    expect(validateNewPasswordInput('abcdef', 'abcdeg')).toContain('일치')
    expect(validateNewPasswordInput('한글비밀번호12', '한글비밀번호12')).toContain('영문')
  })

  it('검증: 6자·72자 경계는 통과한다', () => {
    expect(validateNewPasswordInput('abc123', 'abc123')).toBeNull()
    expect(validateNewPasswordInput('a'.repeat(72), 'a'.repeat(72))).toBeNull()
  })

  it('서버 검증(validateNewPassword)과 같은 입력에서 같은 허용/거절 결과', () => {
    const samples = ['', 'abc12', 'abc123', 'a'.repeat(72), 'a'.repeat(73), '한글비밀번호12', 'ab cd12', 'Passw0rd!', '😀😀😀😀😀😀']
    for (const pw of samples) {
      const client = validateNewPasswordInput(pw, pw) === null
      const server = validateNewPassword(pw).ok
      expect({ pw, client }).toEqual({ pw, client: server })
    }
  })
})

describe('/auth/reset-password 랜딩 화면 소스 점검', () => {
  const src = readFileSync('src/routes/auth/reset-password/+page.svelte', 'utf-8')
  it('공용 규칙을 쓰고 8자 하드코딩·옛 메일 안내 문구가 없다', () => {
    expect(src).toContain('sanitizePasswordInput')
    expect(src).toContain('validateNewPasswordInput')
    expect(src).not.toContain('8자 이상')
    expect(src).not.toContain('로그인 화면에서 재설정 링크를 다시 요청')
  })
  it('두 비밀번호 입력란 모두 글자수 제한(72)과 입력 정리를 가진다', () => {
    expect(src.match(/maxlength=\{PASSWORD_MAX\}/g)?.length).toBe(2)
    expect(src.match(/sanitizePasswordInput\(/g)?.length).toBeGreaterThanOrEqual(2)
  })
  it('만료 안내는 운영자 재요청 또는 문자 인증 비밀번호 찾기를 안내한다', () => {
    expect(src).toContain('운영자')
    expect(src).toContain('비밀번호 찾기')
  })
})
