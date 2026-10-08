import { describe, it, expect } from 'vitest'
import { sanitizeLockerInput, isValidLockerNumber, isValidLockerPassword } from '$lib/utils/lockerFields'

describe('무인보관함 입력 규칙 — 숫자·특수문자만', () => {
  it('sanitize: 영문·한글·공백은 제거하고 숫자·특수문자는 유지', () => {
    expect(sanitizeLockerInput('12ab가나 34')).toBe('1234')
    expect(sanitizeLockerInput('A-1#*')).toBe('-1#*')
    expect(sanitizeLockerInput('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~0')).toBe('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~0')
    expect(sanitizeLockerInput('ＡＢ１２')).toBe('')  // 전각 문자 불가
  })

  it('무인함 번호: 1~10자, 숫자·특수문자만', () => {
    expect(isValidLockerNumber('3')).toBe(true)
    expect(isValidLockerNumber('B-12')).toBe(false)
    expect(isValidLockerNumber('-12')).toBe(true)
    expect(isValidLockerNumber('')).toBe(false)
    expect(isValidLockerNumber('12345678901')).toBe(false)
    expect(isValidLockerNumber('1 2')).toBe(false)
  })

  it('비밀번호: 4~10자, 숫자·특수문자만', () => {
    expect(isValidLockerPassword('1234')).toBe(true)
    expect(isValidLockerPassword('12*#')).toBe(true)
    expect(isValidLockerPassword('123')).toBe(false)
    expect(isValidLockerPassword('12345678901')).toBe(false)
    expect(isValidLockerPassword('12ab')).toBe(false)
    expect(isValidLockerPassword('가나다라')).toBe(false)
  })
})
