// 무인보관함 안내 '추가 자동 발송 시간' 규칙 (2026-11-13, Stephen 지시) — 화면(푸시알림 설정)·서버(저장 검증·크론)가 같은 규칙을 쓴다. 순수 함수.
// 수령(반납) 예정일 당일의 지정 시각(KST, 01:00~24:00 · 분은 10분 단위)에 같은 안내문장을 기본 '1시간 전 자동 발송' 외에 한 번 더 보낸다.
// 24:00 은 날짜가 바뀌기 전 당일 23:50 으로 처리한다(Stephen 확정) — 크론이 10분 간격이라 23:50 이후 첫 실행에 나간다.

export const LOCKER_TIMER_KEY = 'locker_guide_timer'
export const LOCKER_TIMER_LAST_MINUTE = 23 * 60 + 50

/** pickupPrev = 수령일 전날 사전 발송, pickup = 수령일 당일, return = 반납일 당일 */
export type LockerTimerLeg = 'pickupPrev' | 'pickup' | 'return'

/** 'HH:MM'(KST, 24시간제) — 01:00 ~ 23:50 의 10분 단위 또는 '24:00' */
export interface LockerGuideTimer {
  /** 수령 전날 사전 발송 시각(수령일이 내일인 건), 없으면 null */
  pickupPrev: string | null
  /** 수령일 당일 발송 시각, 없으면 null */
  pickup: string | null
  /** 반납일 당일 발송 시각, 없으면 null */
  return: string | null
}

export const EMPTY_LOCKER_TIMER: LockerGuideTimer = { pickupPrev: null, pickup: null, return: null }

const TIME_RE = /^(0[1-9]|1\d|2[0-3]):[0-5]0$/

export function isValidTimerTime(v: unknown): v is string {
  return typeof v === 'string' && (v === '24:00' || TIME_RE.test(v))
}

/** 하루 안에서의 발송 시각(분). '24:00'은 당일 23:50. 형식 오류는 -1. */
export function timerTimeToMinutes(time: string): number {
  if (!isValidTimerTime(time)) return -1
  if (time === '24:00') return LOCKER_TIMER_LAST_MINUTE
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
}

/** 화면 선택 값을 검증한다. ''는 null(= 추가 발송 없음), 형식·범위 오류는 undefined. */
export function parseTimerValue(value: unknown): string | null | undefined {
  if (value === '' || value === null) return null
  return isValidTimerTime(value) ? value : undefined
}

/** 옛 저장 형식(시 단위 숫자: 19 = 19:00, 9.5 = 09:30)을 'HH:MM'으로 */
function legacyHourToTime(v: unknown): string | null {
  if (typeof v !== 'number' || !Number.isInteger(v * 2) || v < 1 || v > 24) return null
  const h = Math.floor(v)
  return `${String(h).padStart(2, '0')}:${v - h >= 0.5 ? '30' : '00'}`
}

/** 저장소(cms_settings.value)에서 읽은 값을 안전하게 해석한다. 형식이 어긋난 칸은 null. */
export function parseLockerGuideTimer(raw: unknown): LockerGuideTimer {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_LOCKER_TIMER }
  const r = raw as Record<string, unknown>
  const one = (v: unknown): string | null => (isValidTimerTime(v) ? v : legacyHourToTime(v))
  return { pickupPrev: isValidTimerTime(r.pickupPrev) ? r.pickupPrev : null, pickup: one(r.pickup), return: one(r.return) }
}
