import { describe, it, expect } from 'vitest'
import { isReturnNoticeReached, returnDayState } from '$lib/utils/returnNoticeTime'

const at = (s: string) => new Date(s) // KST 표기로 입력

describe('isReturnNoticeReached — 반납 안내 시각 도달(DB claim_return_notice_targets 와 같은 규칙)', () => {
  it('택배류·방문·미지정: 반납일 당일 09:00 KST부터', () => {
    expect(isReturnNoticeReached('epost', '2026-10-22', '18:00', at('2026-10-22T08:59:00+09:00'))).toBe(false)
    expect(isReturnNoticeReached('epost', '2026-10-22', '18:00', at('2026-10-22T09:00:00+09:00'))).toBe(true)
    expect(isReturnNoticeReached('visit', '2026-10-22', null, at('2026-10-22T09:30:00+09:00'))).toBe(true)
    expect(isReturnNoticeReached(null, '2026-10-23', null, at('2026-10-22T23:00:00+09:00'))).toBe(false)
  })
  it('퀵·무인함: 반납 일시 3시간 전부터(시각 없음·형식 오류=18:00)', () => {
    expect(isReturnNoticeReached('quick', '2026-10-22', '14:00', at('2026-10-22T10:59:00+09:00'))).toBe(false)
    expect(isReturnNoticeReached('quick', '2026-10-22', '14:00', at('2026-10-22T11:00:00+09:00'))).toBe(true)
    expect(isReturnNoticeReached('locker', '2026-10-22', null, at('2026-10-22T15:00:00+09:00'))).toBe(true)
    expect(isReturnNoticeReached('locker', '2026-10-22', 'abc', at('2026-10-22T14:59:00+09:00'))).toBe(false)
  })
  it('반납일이 지났으면 모든 방식에서 도달, 날짜 형식 오류는 미도달', () => {
    expect(isReturnNoticeReached('quick', '2026-10-20', '10:00', at('2026-10-22T09:00:00+09:00'))).toBe(true)
    expect(isReturnNoticeReached('epost', null, null, at('2026-10-22T09:00:00+09:00'))).toBe(false)
  })
  it('returnDayState — 대여중에서만 값이 있다', () => {
    expect(returnDayState('in_use', '2026-10-22', 'epost', null, at('2026-10-22T10:00:00+09:00'))).toBe('reached')
    expect(returnDayState('in_use', '2026-10-23', 'epost', null, at('2026-10-22T10:00:00+09:00'))).toBe('before')
    expect(returnDayState('return_requested', '2026-10-22', 'epost', null)).toBeUndefined()
  })
})
