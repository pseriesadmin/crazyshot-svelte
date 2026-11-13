import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  isValidTimerHour,
  timerHourToMinutes,
  timerHourLabel,
  parseTimerHourValue,
  parseLockerGuideTimer,
} from '$lib/utils/lockerGuideTimer'

describe('무인보관함 안내 추가 자동 발송 시간 규칙', () => {
  it('1~24시(정수)만 유효하다', () => {
    expect(isValidTimerHour(1)).toBe(true)
    expect(isValidTimerHour(24)).toBe(true)
    for (const bad of [0, 25, 1.5, '9', null, undefined, NaN]) expect(isValidTimerHour(bad)).toBe(false)
  })
  it('24시는 당일 23:50(1430분), 나머지는 시×60분', () => {
    expect(timerHourToMinutes(24)).toBe(1430)
    expect(timerHourToMinutes(1)).toBe(60)
    expect(timerHourToMinutes(9)).toBe(540)
    expect(timerHourToMinutes(23)).toBe(1380)
  })
  it('화면 선택 값 변환: HH:00 → 시, 빈 값 → null(해제), 그 외 → undefined', () => {
    expect(parseTimerHourValue('09:00')).toBe(9)
    expect(parseTimerHourValue('24:00')).toBe(24)
    expect(parseTimerHourValue('')).toBeNull()
    for (const bad of ['00:00', '25:00', '09:30', '9:00', 'abc', 9, undefined]) expect(parseTimerHourValue(bad)).toBeUndefined()
    expect(timerHourLabel(9)).toBe('09:00')
    expect(timerHourLabel(24)).toBe('24:00')
  })
  it('저장 값 해석: 형식이 어긋난 칸은 null', () => {
    expect(parseLockerGuideTimer({ pickup: 9, return: 14 })).toEqual({ pickup: 9, return: 14 })
    expect(parseLockerGuideTimer({ pickup: 0, return: '3' })).toEqual({ pickup: null, return: null })
    expect(parseLockerGuideTimer(null)).toEqual({ pickup: null, return: null })
  })
})

describe('추가 타이머 연결 점검(소스 스캔)', () => {
  const cron = readFileSync('src/routes/api/cron/locker-guide/+server.ts', 'utf8')
  const mig = readFileSync('supabase/migrations/20261113100000_821_locker_guide_timer.sql', 'utf8')
  const action = readFileSync('src/routes/cms/set/push/+page.server.ts', 'utf8')
  it('크론은 기본 안내 뒤에 타이머 대상을 선점하고, 실패 건은 표식을 되돌린다', () => {
    expect(cron).toContain("rpc('claim_locker_guide_timer'")
    expect(cron).toContain("rpc('release_locker_guide_timer_claim'")
    expect(cron.indexOf("rpc('claim_reservations_due_for_locker_guide'")).toBeLessThan(cron.indexOf("rpc('claim_locker_guide_timer'"))
    expect(cron).toContain('timerHourToMinutes')
  })
  it('DB 함수는 서버 전용이다(anon·authenticated 회수 + service_role 부여)', () => {
    for (const fn of ['claim_locker_guide_timer(integer, integer, integer)', 'release_locker_guide_timer_claim(bigint, text)']) {
      expect(mig).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated;`)
      expect(mig).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO service_role;`)
    }
  })
  it('DB 함수는 기본 안내 미발송·수령(반납) 시각 전·1시간 유예 조건을 갖는다', () => {
    expect(mig).toContain('locker_guide_sent_pickup_at IS NULL')
    expect(mig).toContain('locker_guide_sent_return_at IS NULL')
    expect(mig).toContain("INTERVAL '1 hour'")
    expect(mig).toContain("(r.start_date + r.pickup_time::time) AT TIME ZONE 'Asia/Seoul'")
  })
  it('저장 액션은 매니저 이상만, 서버에서 값 재검증한다', () => {
    const i = action.indexOf('updateLockerTimer:')
    const body = action.slice(i, i + 1600)
    expect(body).toContain('hasSettingsAccess(cmsRole)')
    expect(body).toContain('parseTimerHourValue')
  })
})
