import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { isValidTimerTime, timerTimeToMinutes, parseTimerValue, parseLockerGuideTimer } from '$lib/utils/lockerGuideTimer'

describe('무인보관함 안내 추가 자동 발송 시간 규칙', () => {
  it('01:00 ~ 23:50 의 10분 단위와 24:00 만 유효하다', () => {
    for (const ok of ['01:00', '01:10', '09:30', '19:00', '23:50', '24:00']) expect(isValidTimerTime(ok)).toBe(true)
    for (const bad of ['00:00', '00:10', '09:05', '09:15', '24:10', '24:30', '25:00', '9:00', '', 'abc', 9, null, undefined]) expect(isValidTimerTime(bad)).toBe(false)
  })
  it('24:00 은 당일 23:50(1430분), 나머지는 시×60+분', () => {
    expect(timerTimeToMinutes('24:00')).toBe(1430)
    expect(timerTimeToMinutes('01:00')).toBe(60)
    expect(timerTimeToMinutes('09:30')).toBe(570)
    expect(timerTimeToMinutes('19:10')).toBe(1150)
    expect(timerTimeToMinutes('23:50')).toBe(1430)
    expect(timerTimeToMinutes('bad')).toBe(-1)
  })
  it('화면 선택 값 검증: 유효 값은 그대로, 빈 값은 null(해제), 그 외는 undefined', () => {
    expect(parseTimerValue('09:30')).toBe('09:30')
    expect(parseTimerValue('24:00')).toBe('24:00')
    expect(parseTimerValue('')).toBeNull()
    expect(parseTimerValue(null)).toBeNull()
    for (const bad of ['00:00', '09:15', '24:30', 9, undefined]) expect(parseTimerValue(bad)).toBeUndefined()
  })
  it('저장 값 해석: 새 형식은 그대로, 옛 시 단위 숫자는 HH:MM 으로, 형식 오류 칸은 null', () => {
    expect(parseLockerGuideTimer({ pickupPrev: '21:00', pickup: '09:10', return: '14:00' })).toEqual({ pickupPrev: '21:00', pickup: '09:10', return: '14:00' })
    expect(parseLockerGuideTimer({ pickup: 19, return: 9.5 })).toEqual({ pickupPrev: null, pickup: '19:00', return: '09:30' })
    expect(parseLockerGuideTimer({ pickupPrev: 19, pickup: 0, return: '3' })).toEqual({ pickupPrev: null, pickup: null, return: null })
    expect(parseLockerGuideTimer(null)).toEqual({ pickupPrev: null, pickup: null, return: null })
  })
})

describe('추가 타이머 연결 점검(소스 스캔)', () => {
  const cron = readFileSync('src/routes/api/cron/locker-guide/+server.ts', 'utf8')
  const mig = readFileSync('supabase/migrations/20261113100000_821_locker_guide_timer.sql', 'utf8')
  const action = readFileSync('src/routes/cms/set/push/+page.server.ts', 'utf8')
  const picker = readFileSync('src/lib/components/cms/CmsTimePicker.svelte', 'utf8')
  const migPrev = readFileSync('supabase/migrations/20261113130000_824_locker_guide_prev_day.sql', 'utf8')
  it('크론은 기본 안내 뒤에 타이머 대상을 선점하고, 실패 건은 표식을 되돌린다', () => {
    expect(cron).toContain("rpc('claim_locker_guide_timer'")
    expect(cron).toContain("rpc('release_locker_guide_timer_claim'")
    expect(cron.indexOf("rpc('claim_reservations_due_for_locker_guide'")).toBeLessThan(cron.indexOf("rpc('claim_locker_guide_timer'"))
    expect(cron).toContain('timerTimeToMinutes')
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
    expect(body).toContain('parseTimerValue')
  })
  it('수령 전날 사전 발송: 크론이 별도 함수로 선점하고, DB 함수는 서버 전용·내일 수령 건만 대상으로 한다', () => {
    expect(cron).toContain("rpc('claim_locker_guide_prev_day'")
    expect(cron).toContain("rpc('release_locker_guide_prev_claim'")
    expect(cron).toContain('timerCfg.pickupPrev')
    for (const fn of ['claim_locker_guide_prev_day(integer, integer)', 'release_locker_guide_prev_claim(bigint)']) {
      expect(migPrev).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated;`)
      expect(migPrev).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO service_role;`)
    }
    expect(migPrev).toContain('(r.start_date - 1)::timestamp')
    expect(migPrev).toContain('locker_guide_sent_pickup_at IS NULL')
    expect(migPrev).toContain('locker_guide_prev_pickup_at IS NULL')
    expect(migPrev).toContain("(r.start_date + r.pickup_time::time) AT TIME ZONE 'Asia/Seoul'")
  })
  it('시간 선택기 instant 모드: 시·분 목록(분 10단위)을 고르는 즉시 반영하고 저장 버튼이 없다', () => {
    expect(picker).toContain("const INSTANT_MINUTES = ['00', '10', '20', '30', '40', '50']")
    // Enter 로 낡은 휠 값을 저장하지 않는다(sp3 M1) — Enter 처리는 휠 모드에서만
    expect(picker).toContain("else if (e.key === 'Enter' && !instant)")
    const a = picker.indexOf('{#if instant}')
    const b = picker.indexOf('{:else}', a)
    expect(a).toBeGreaterThan(-1)
    expect(picker.slice(a, b)).not.toContain('tp-btn')
  })
})
