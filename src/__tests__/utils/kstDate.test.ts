import { describe, it, expect } from 'vitest'
import { formatKstDateDot, formatKstDateTimeDot, formatKstDateDash, kstLocalToIso } from '$lib/utils/kstDate'

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

// 레거시 회원 CSV 가입 시각 +9시간 밀림(2026-10-29) — CSV 의 시각은 한국시간인데 서버(UTC)가 UTC 로 읽어 저장하던 결함 회귀 방지.
describe('kstLocalToIso — 시간대 표시 없는 한국시간 문자열 → 정확한 시각', () => {
  it('"YYYY-MM-DD HH:mm:ss" 는 한국시간으로 보고 UTC 로 바꾼다(−9시간)', () => {
    expect(kstLocalToIso('2026-04-11 19:13:29')).toBe('2026-04-11T10:13:29.000Z')
  })

  it('한국시간 새벽(00:00~08:59)은 UTC 로 전날이 된다', () => {
    expect(kstLocalToIso('2026-05-31 01:08:27')).toBe('2026-05-30T16:08:27.000Z')
    expect(kstLocalToIso('2026-01-01 00:00:00')).toBe('2025-12-31T15:00:00.000Z')
  })

  it('T 구분자·초 없음·앞뒤 공백도 받는다', () => {
    expect(kstLocalToIso('2026-04-11T19:13:29')).toBe('2026-04-11T10:13:29.000Z')
    expect(kstLocalToIso('2026-04-11 19:13')).toBe('2026-04-11T10:13:00.000Z')
    expect(kstLocalToIso('  2026-04-11 19:13:29  ')).toBe('2026-04-11T10:13:29.000Z')
  })

  it('날짜만 있으면 한국시간 0시로 본다', () => {
    expect(kstLocalToIso('2026-09-11')).toBe('2026-09-10T15:00:00.000Z')
  })

  it('점·슬래시 날짜 형식도 받는다', () => {
    expect(kstLocalToIso('2026.09.11')).toBe('2026-09-10T15:00:00.000Z')
    expect(kstLocalToIso('2026/09/11 08:30:00')).toBe('2026-09-10T23:30:00.000Z')
  })

  it('이미 시간대(Z·+09:00)가 붙은 값은 그대로 존중한다', () => {
    expect(kstLocalToIso('2026-04-11T10:13:29Z')).toBe('2026-04-11T10:13:29.000Z')
    expect(kstLocalToIso('2026-04-11T19:13:29+09:00')).toBe('2026-04-11T10:13:29.000Z')
  })

  it('빈 값·잘못된 값·존재하지 않는 날짜는 null (오류를 던지지 않는다)', () => {
    expect(kstLocalToIso('')).toBeNull()
    expect(kstLocalToIso(null)).toBeNull()
    expect(kstLocalToIso(undefined)).toBeNull()
    expect(kstLocalToIso('not-a-date')).toBeNull()
    expect(kstLocalToIso('2026-13-45 99:99:99')).toBeNull()
    expect(kstLocalToIso('2026-02-30')).toBeNull()
  })

  it('서버 시간대(TZ)가 UTC 든 KST 든 결과가 같다', () => {
    const before = process.env.TZ
    try {
      process.env.TZ = 'UTC'
      const a = kstLocalToIso('2026-04-11 19:13:29')
      process.env.TZ = 'Asia/Seoul'
      const b = kstLocalToIso('2026-04-11 19:13:29')
      expect(a).toBe('2026-04-11T10:13:29.000Z')
      expect(b).toBe(a)
    } finally {
      if (before === undefined) delete process.env.TZ
      else process.env.TZ = before
    }
  })
})

describe('formatKstDateDash — 저장된 시각을 한국 날짜 "YYYY-MM-DD" 로', () => {
  it('UTC 전날 16:08(=KST 새벽 01:08)은 한국 날짜로 표기한다', () => {
    expect(formatKstDateDash('2026-05-30T16:08:27.000Z')).toBe('2026-05-31')
  })

  it('UTC 14:59(=KST 23:59)는 같은 날', () => {
    expect(formatKstDateDash('2026-10-05T14:59:59.000Z')).toBe('2026-10-05')
  })

  it('잘못된 값·빈 값은 빈 문자열', () => {
    expect(formatKstDateDash('not-a-date')).toBe('')
    expect(formatKstDateDash(null)).toBe('')
    expect(formatKstDateDash(undefined)).toBe('')
  })

  it('kstLocalToIso 로 저장한 값을 되읽으면 원래 한국 날짜가 나온다(왕복)', () => {
    for (const src of ['2026-04-11 19:13:29', '2026-05-31 01:08:27', '2026-01-01 00:00:00', '2026-12-31 23:59:59']) {
      expect(formatKstDateDash(kstLocalToIso(src))).toBe(src.slice(0, 10))
    }
  })
})
