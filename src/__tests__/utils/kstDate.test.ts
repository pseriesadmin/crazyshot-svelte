import { describe, it, expect } from 'vitest'
import { formatKstDateDot, formatKstDateTimeDot } from '$lib/utils/kstDate'

// 계약서 발행일 UTC 오표기(2026-10-06) — 한국시간 00:00~08:59가 UTC로는 전날이라 하루 전 날짜로 찍히던 결함 회귀 방지.
describe('formatKstDateDot', () => {
  it('UTC 15:30(=KST 다음날 00:30)은 KST 날짜로 표기한다', () => {
    expect(formatKstDateDot('2026-10-05T15:30:00.000Z')).toBe('2026.10.06')
  })

  it('UTC 14:59(=KST 23:59)는 같은 날로 표기한다', () => {
    expect(formatKstDateDot('2026-10-05T14:59:59.000Z')).toBe('2026.10.05')
  })

  it('UTC 15:00 정각(=KST 00:00)부터 다음날이다', () => {
    expect(formatKstDateDot('2026-10-05T15:00:00.000Z')).toBe('2026.10.06')
  })

  it('월·연 경계(UTC 12-31 16:00 = KST 01-01 01:00)를 넘긴다', () => {
    expect(formatKstDateDot('2026-12-31T16:00:00.000Z')).toBe('2027.01.01')
  })

  it('Date 객체도 받는다', () => {
    expect(formatKstDateDot(new Date('2026-10-05T23:00:00.000Z'))).toBe('2026.10.06')
  })

  it('잘못된 값·빈 값은 "-"', () => {
    expect(formatKstDateDot('not-a-date')).toBe('-')
    expect(formatKstDateDot(null)).toBe('-')
    expect(formatKstDateDot(undefined)).toBe('-')
  })
})

describe('formatKstDateTimeDot', () => {
  it('KST 날짜와 시각(24시간)을 함께 표기한다', () => {
    expect(formatKstDateTimeDot('2026-10-05T15:30:00.000Z')).toBe('2026.10.06 00:30')
    expect(formatKstDateTimeDot('2026-10-06T03:10:30.000Z')).toBe('2026.10.06 12:10')
  })

  it('잘못된 값은 "-"', () => {
    expect(formatKstDateTimeDot('x')).toBe('-')
  })
})
