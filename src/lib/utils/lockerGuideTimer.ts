// 무인보관함 안내 '추가 자동 발송 시간' 규칙 (2026-11-13, Stephen 지시) — 화면(푸시알림 설정)·서버(저장 검증·크론)가 같은 규칙을 쓴다. 순수 함수.
// 수령(반납) 예정일 당일의 지정 시각(KST, 01:00~24:00 · 1시간 단위)에 같은 안내문장을 기본 '1시간 전 자동 발송' 외에 한 번 더 보낸다.
// 24:00 은 날짜가 바뀌기 전 당일 23:50 으로 처리한다(Stephen 확정) — 크론이 10분 간격이라 23:50 이후 첫 실행에 나간다.

export const LOCKER_TIMER_KEY = 'locker_guide_timer'
export const LOCKER_TIMER_MIN_HOUR = 1
export const LOCKER_TIMER_MAX_HOUR = 24
export const LOCKER_TIMER_LAST_MINUTE = 23 * 60 + 50

export type LockerTimerLeg = 'pickup' | 'return'

export interface LockerGuideTimer {
  /** 수령일 당일 발송 시(1~24), 없으면 null */
  pickup: number | null
  /** 반납일 당일 발송 시(1~24), 없으면 null */
  return: number | null
}

export const EMPTY_LOCKER_TIMER: LockerGuideTimer = { pickup: null, return: null }

export function isValidTimerHour(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= LOCKER_TIMER_MIN_HOUR && v <= LOCKER_TIMER_MAX_HOUR
}

/** 하루 안에서의 발송 시각(분). 24시는 당일 23:50. */
export function timerHourToMinutes(hour: number): number {
  return hour >= LOCKER_TIMER_MAX_HOUR ? LOCKER_TIMER_LAST_MINUTE : hour * 60
}

/** 선택 값 표기 'HH:00' (24시는 '24:00') */
export function timerHourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

/** 화면 시간 선택 값('HH:00')을 시(1~24)로. ''는 null(= 추가 발송 없음), 형식·범위 오류는 undefined. */
export function parseTimerHourValue(value: unknown): number | null | undefined {
  if (value === '' || value === null) return null
  if (typeof value !== 'string') return undefined
  const m = /^(\d{2}):00$/.exec(value)
  if (!m) return undefined
  const h = Number(m[1])
  return isValidTimerHour(h) ? h : undefined
}

/** 저장소(cms_settings.value)에서 읽은 값을 안전하게 해석한다. 형식이 어긋난 칸은 null. */
export function parseLockerGuideTimer(raw: unknown): LockerGuideTimer {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_LOCKER_TIMER }
  const r = raw as Record<string, unknown>
  return {
    pickup: isValidTimerHour(r.pickup) ? r.pickup : null,
    return: isValidTimerHour(r.return) ? r.return : null,
  }
}
