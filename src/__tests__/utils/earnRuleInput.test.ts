import { describe, it, expect } from 'vitest'
import { parseEarnRuleInput, rateToPercentText, percentToRate } from '$lib/utils/earnRuleInput'

describe('earnRuleInput — 적립률 % 입력 해석', () => {
  it('3(%)을 입력하면 DB 저장값 0.03이 된다', () => {
    expect(parseEarnRuleInput('0', '3')).toEqual({ ok: true, amount: 0, rate: 0.03 })
  })
  it('소수 둘째 자리 % 도 정확히 저장값으로 바뀐다(1.25% → 0.0125)', () => {
    expect(percentToRate(1.25)).toBe(0.0125)
    expect(percentToRate(0.07)).toBe(0.0007)
  })
  it('100%는 허용, 100 초과·음수는 거절', () => {
    expect(parseEarnRuleInput('0', '100')).toMatchObject({ ok: true, rate: 1 })
    expect(parseEarnRuleInput('0', '100.01').ok).toBe(false)
    expect(parseEarnRuleInput('0', '-1').ok).toBe(false)
  })
  it('빈 칸·숫자 아님은 0으로 조용히 저장하지 않고 거절', () => {
    expect(parseEarnRuleInput('', '3').ok).toBe(false)
    expect(parseEarnRuleInput('0', '').ok).toBe(false)
    expect(parseEarnRuleInput('0', 'abc').ok).toBe(false)
    expect(parseEarnRuleInput(null, '3').ok).toBe(false)
  })
  it('고정 적립은 0 이상 정수만', () => {
    expect(parseEarnRuleInput('1000', '0')).toMatchObject({ ok: true, amount: 1000 })
    expect(parseEarnRuleInput('-1', '0').ok).toBe(false)
    expect(parseEarnRuleInput('1.5', '0').ok).toBe(false)
  })
  it('저장값 → 입력칸 표시는 % 단위, 부동소수 잡음 없음', () => {
    expect(rateToPercentText(0.03)).toBe('3')
    expect(rateToPercentText(0.0125)).toBe('1.25')
    expect(rateToPercentText(0)).toBe('0')
    expect(rateToPercentText(0.07)).toBe('7')
  })
})
