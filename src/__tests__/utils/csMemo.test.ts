// csMemo.test.ts — 상담 메모 단문 검증(100자, 줄바꿈 합침)
import { describe, it, expect } from 'vitest'
import { CS_MEMO_MAX, checkCsMemo, normalizeCsMemo } from '$lib/utils/csMemo'

describe('상담 메모 검증', () => {
  it('상한은 100자', () => { expect(CS_MEMO_MAX).toBe(100) })
  it('빈 값·공백만·문자열 아님은 거절', () => {
    expect(checkCsMemo('').ok).toBe(false)
    expect(checkCsMemo('  \n ').ok).toBe(false)
    expect(checkCsMemo(null).ok).toBe(false)
    expect(checkCsMemo(123).ok).toBe(false)
  })
  it('정확히 100자는 허용, 101자는 거절(한글·영문·숫자·특수문자 모두 1자)', () => {
    expect(checkCsMemo('가'.repeat(100)).ok).toBe(true)
    expect(checkCsMemo('가'.repeat(101)).ok).toBe(false)
    expect(checkCsMemo('a1!#'.repeat(25)).ok).toBe(true)
    expect(checkCsMemo('a1!#'.repeat(25) + 'x').ok).toBe(false)
  })
  it('이모지는 1자로 센다', () => {
    expect(checkCsMemo('😀'.repeat(100)).ok).toBe(true)
    expect(checkCsMemo('😀'.repeat(101)).ok).toBe(false)
  })
  it('줄바꿈·연속 공백은 한 칸으로 합치고 앞뒤를 자른다', () => {
    expect(normalizeCsMemo('  첫줄\n\n둘째줄   셋째 ')).toBe('첫줄 둘째줄 셋째')
    const r = checkCsMemo('a\nb')
    expect(r).toEqual({ ok: true, text: 'a b' })
  })
})
