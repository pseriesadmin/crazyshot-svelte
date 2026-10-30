import { describe, it, expect } from 'vitest'
import { pickupTimeLimits, returnTimeLimits, isTimeWithinLimits } from '$lib/utils/pickupTimeRules'

// KST 시각을 UTC epoch ms 로 만든다(실행 환경 타임존과 무관)
const kst = (y: number, m: number, d: number, h: number, min = 0, sec = 0): number => Date.UTC(y, m - 1, d, h - 9, min, sec)
const TODAY = '2026-10-30'
const TOMORROW = '2026-10-31'

describe('수령 시간 — 방문·무인보관함(당일 기본 규칙: 선택 시점 + 2시간 미만 불가)', () => {
  it('15:03 → 오늘은 17:03 이전 불가(17:30부터), 내일은 제한 없음', () => {
    const now = kst(2026, 10, 30, 15, 3)
    expect(pickupTimeLimits('visit', TODAY, now)).toEqual({ disabledBefore: '17:03', disabledAfter: null })
    expect(pickupTimeLimits('locker', TODAY, now)).toEqual({ disabledBefore: '17:03', disabledAfter: null })
    expect(pickupTimeLimits('visit', TOMORROW, now)).toEqual({ disabledBefore: null, disabledAfter: null })
  })
  it('초 단위는 올림 — 15:00:30 이면 17:01 이전 불가(2시간 미만 슬롯 17:00 차단)', () => {
    const now = kst(2026, 10, 30, 15, 0, 30)
    expect(pickupTimeLimits('visit', TODAY, now).disabledBefore).toBe('17:01')
  })
  it('18:00 정각까지는 기본 규칙 — 20:00부터 선택', () => {
    expect(pickupTimeLimits('visit', TODAY, kst(2026, 10, 30, 18, 0, 0)).disabledBefore).toBe('20:00')
  })
  it('예외: 18:01~익일 09:00 에는 다음 09:00 기준 +2시간 — 오늘 전체 불가, 내일은 11:00 이전 불가', () => {
    const now = kst(2026, 10, 30, 18, 1)
    expect(pickupTimeLimits('visit', TODAY, now).disabledBefore).toBe('24:00')
    expect(pickupTimeLimits('visit', TOMORROW, now).disabledBefore).toBe('11:00')
    expect(pickupTimeLimits('locker', '2026-11-01', now).disabledBefore).toBeNull()
    const late = kst(2026, 10, 30, 23, 40)
    expect(pickupTimeLimits('locker', TOMORROW, late).disabledBefore).toBe('11:00')
  })
  it('예외: 새벽(00:00~09:00)에는 오늘 09:00 기준 — 오늘 11:00 이전 불가', () => {
    expect(pickupTimeLimits('visit', TODAY, kst(2026, 10, 30, 2, 0)).disabledBefore).toBe('11:00')
    expect(pickupTimeLimits('visit', TODAY, kst(2026, 10, 30, 9, 0)).disabledBefore).toBe('11:00')
    expect(pickupTimeLimits('visit', TOMORROW, kst(2026, 10, 30, 2, 0)).disabledBefore).toBeNull()
  })
  it('과거 날짜는 전부 불가', () => {
    expect(pickupTimeLimits('visit', '2026-10-29', kst(2026, 10, 30, 15, 0)).disabledBefore).toBe('24:00')
  })
})

describe('수령 시간 — 퀵서비스(12:00~22:00, 당일은 선택 시점 + 3시간 미만 불가)', () => {
  it('내일 이후는 12:00~22:00 창만', () => {
    expect(pickupTimeLimits('quick', TOMORROW, kst(2026, 10, 30, 15, 3))).toEqual({ disabledBefore: '12:00', disabledAfter: '22:00' })
  })
  it('15:03 오늘 → 18:03 이전 불가(18:30부터), 22:00 초과 불가', () => {
    expect(pickupTimeLimits('quick', TODAY, kst(2026, 10, 30, 15, 3))).toEqual({ disabledBefore: '18:03', disabledAfter: '22:00' })
  })
  it('09:00 오늘 → 12:00 정각부터 선택(09:00+3h=12:00)', () => {
    expect(pickupTimeLimits('quick', TODAY, kst(2026, 10, 30, 9, 0))).toEqual({ disabledBefore: '12:00', disabledAfter: '22:00' })
  })
  it('20:00 오늘 → 23:00 이후만 가능한데 22:00 초과라 선택 가능한 슬롯이 없다', () => {
    const l = pickupTimeLimits('quick', TODAY, kst(2026, 10, 30, 20, 0))
    expect(l).toEqual({ disabledBefore: '23:00', disabledAfter: '22:00' })
    expect(['12:00', '22:00', '23:00', '23:30'].some((t) => isTimeWithinLimits(l, t))).toBe(false)
  })
  it('22:30 → 익일 01:30 이후라 내일은 12:00부터', () => {
    expect(pickupTimeLimits('quick', TOMORROW, kst(2026, 10, 30, 22, 30))).toEqual({ disabledBefore: '12:00', disabledAfter: '22:00' })
  })
})

describe('그 외 수령 방식·날짜 없음 — 제한 없음', () => {
  it('배송형·택배·미선택·날짜 없음', () => {
    const now = kst(2026, 10, 30, 15, 3)
    for (const m of ['delivery', 'crazydelivery', 'epost', null, undefined]) {
      expect(pickupTimeLimits(m, TODAY, now)).toEqual({ disabledBefore: null, disabledAfter: null })
    }
    expect(pickupTimeLimits('visit', '', now)).toEqual({ disabledBefore: null, disabledAfter: null })
  })
})

describe('반납 시간', () => {
  it('퀵: 09:00~09:30 만 가능', () => {
    const l = returnTimeLimits('quick', TOMORROW, TODAY, '12:00')
    expect(l).toEqual({ disabledBefore: '09:00', disabledAfter: '09:30' })
    expect(isTimeWithinLimits(l, '09:00')).toBe(true)
    expect(isTimeWithinLimits(l, '09:30')).toBe(true)
    expect(isTimeWithinLimits(l, '08:30')).toBe(false)
    expect(isTimeWithinLimits(l, '10:00')).toBe(false)
  })
  it('퀵: 반납일 = 수령일(수령 12:00 이후)이면 09:00~09:30 이 수령 이전이라 선택 가능한 슬롯이 없다', () => {
    const l = returnTimeLimits('quick', TODAY, TODAY, '12:00')
    expect(['09:00', '09:30', '12:00', '13:00'].some((t) => isTimeWithinLimits(l, t))).toBe(false)
  })
  it('방문·무인: 범위 제한 없음, 같은 날이면 수령 시각 이전 불가(같은 시각은 가능)', () => {
    expect(returnTimeLimits('visit', TOMORROW, TODAY, '14:00')).toEqual({ disabledBefore: null, disabledAfter: null })
    const same = returnTimeLimits('visit', TODAY, TODAY, '14:00')
    expect(same).toEqual({ disabledBefore: '14:00', disabledAfter: null })
    expect(isTimeWithinLimits(same, '13:30')).toBe(false)
    expect(isTimeWithinLimits(same, '14:00')).toBe(true)
    expect(isTimeWithinLimits(returnTimeLimits('locker', TODAY, TODAY, '23:30'), '23:00')).toBe(false)
  })
  it('같은 날이어도 수령 시각이 비어 있으면 제한 없음, 그 외 방식은 제한 없음', () => {
    expect(returnTimeLimits('visit', TODAY, TODAY, '')).toEqual({ disabledBefore: null, disabledAfter: null })
    expect(returnTimeLimits('delivery', TODAY, TODAY, '10:00')).toEqual({ disabledBefore: null, disabledAfter: null })
  })
})

describe('isTimeWithinLimits', () => {
  it('경계는 포함, 빈 값은 통과', () => {
    const l = { disabledBefore: '12:00', disabledAfter: '22:00' }
    expect(isTimeWithinLimits(l, '12:00')).toBe(true)
    expect(isTimeWithinLimits(l, '22:00')).toBe(true)
    expect(isTimeWithinLimits(l, '11:30')).toBe(false)
    expect(isTimeWithinLimits(l, '22:30')).toBe(false)
    expect(isTimeWithinLimits(l, '')).toBe(true)
    expect(isTimeWithinLimits({ disabledBefore: '24:00', disabledAfter: null }, '23:30')).toBe(false)
  })
})
