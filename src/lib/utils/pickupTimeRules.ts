/**
 * 수령·반납 "시간" 선택 가능 범위 규칙 — 장바구니 시간 선택 목록·제출 재검증 공용 순수 함수 (KST 고정, 2026-10-30 Stephen 확정)
 *
 * [수령 시간]
 *  · 방문·무인보관함: 시각 범위 제한 없음(매장 09:00~22:00, 영업 외·주말·공휴일은 무인보관함 자동 — 00:00~24:00).
 *      당일 기본 규칙 = 선택 시점 + 2시간 미만은 불가. 예외: 선택 시점이 18:01~익일 09:00 사이면 다음 09:00 을 기준으로 +2시간(= 11:00 이전 불가).
 *  · 퀵서비스: 12:00~22:00 이외 불가, 당일은 선택 시점 + 3시간 미만 불가.
 * [반납 시간]
 *  · 방문·무인보관함: 시각 범위 제한 없음. 퀵서비스: 09:00~09:30 이외 불가.
 *  · 반납일이 수령일과 같으면 수령 시각 이전 시간대는 불가.
 *
 * 반환값 규칙: 'HH:MM' 문자열 두 개. 슬롯 t 가 선택 가능 ⇔ disabledBefore 이상(없으면 제한 없음) 이고 disabledAfter 이하.
 *  "그 날 전체 불가"는 disabledBefore='24:00'(어떤 'HH:MM'보다 큼)으로 표현한다.
 * 신청 마감(며칠 전 몇 시까지)은 pickupLeadTime.ts 가 맡는다 — 이 파일은 "선택한 날짜 안의 시각"만 다룬다.
 */
export interface TimeLimits {
  /** 이 시각 '미만' 슬롯은 선택 불가. null = 제한 없음 */
  disabledBefore: string | null
  /** 이 시각 '초과' 슬롯은 선택 불가. null = 제한 없음 */
  disabledAfter: string | null
}

export const NO_TIME_LIMITS: TimeLimits = { disabledBefore: null, disabledAfter: null }
const ALL_DAY_BLOCKED = '24:00'

const KST_OFFSET_MS = 9 * 3_600_000
const DAY_MS = 86_400_000
const MIN_MS = 60_000

/** 방문·무인보관함 당일 여유(분) / 퀵 당일 여유(분) */
export const STORE_LOCKER_LEAD_MIN = 120
export const QUICK_LEAD_MIN = 180
/** 방문·무인보관함 기준 영업 시작·신청 마감 시각(분) — 18:01 부터는 다음 영업 시작(09:00)을 기준으로 삼는다 */
const OPEN_MIN = 9 * 60
const CUTOFF_MIN = 18 * 60
const QUICK_PICKUP_FROM = '12:00'
const QUICK_PICKUP_TO = '22:00'
const QUICK_RETURN_FROM = '09:00'
const QUICK_RETURN_TO = '09:30'

const hhmm = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** KST 달력 기준 epoch(ms, KST 벽시계를 UTC 로 본 값) → { 날짜 YYYY-MM-DD, 그 날 0시부터의 분 } */
function kstClock(kstMs: number): { date: string; minutes: number } {
  return { date: new Date(kstMs).toISOString().slice(0, 10), minutes: Math.floor((((kstMs % DAY_MS) + DAY_MS) % DAY_MS) / MIN_MS) }
}

/** 지금부터 선택 가능한 가장 이른 수령 시각(KST 날짜·분). 분 단위는 올림 — 2시간 "미만"을 허용하지 않기 위함 */
function earliestPickup(method: 'storeLocker' | 'quick', nowMs: number): { date: string; minutes: number } {
  const kstNow = nowMs + KST_OFFSET_MS
  const { date: today, minutes: nowMin } = kstClock(kstNow)
  const nowExactMin = Math.ceil((((kstNow % DAY_MS) + DAY_MS) % DAY_MS) / MIN_MS)
  if (method === 'quick') {
    const total = Math.ceil(kstNow / MIN_MS) * MIN_MS + QUICK_LEAD_MIN * MIN_MS
    return kstClock(total)
  }
  // 방문·무인보관함: 영업 시간대(09:00~18:00)면 지금 기준, 18:01~익일 09:00 이면 다음 09:00 기준
  let baseDate = today
  let baseMin = nowExactMin
  if (nowMin > CUTOFF_MIN) {
    baseDate = new Date(Date.parse(`${today}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10)
    baseMin = OPEN_MIN
  } else if (nowMin < OPEN_MIN) {
    baseMin = OPEN_MIN
  }
  const total = Date.parse(`${baseDate}T00:00:00Z`) + (baseMin + STORE_LOCKER_LEAD_MIN) * MIN_MS
  return kstClock(total)
}

function familyOf(method: string | null | undefined): 'storeLocker' | 'quick' | null {
  if (method === 'visit' || method === 'locker') return 'storeLocker'
  if (method === 'quick') return 'quick'
  return null
}

/** 수령일(dateIso)에서 선택 가능한 수령 시각 범위 */
export function pickupTimeLimits(method: string | null | undefined, dateIso: string | null | undefined, nowMs: number): TimeLimits {
  const family = familyOf(method)
  if (!family || !dateIso) return NO_TIME_LIMITS
  const e = earliestPickup(family, nowMs)

  let before: string | null = null
  if (dateIso < e.date) before = ALL_DAY_BLOCKED
  else if (dateIso === e.date) before = hhmm(e.minutes)

  if (family === 'quick') {
    // 12:00 이전은 항상 불가, 22:00 초과도 불가 — 날짜가 달라도 같은 창
    const from = before !== null && before > QUICK_PICKUP_FROM ? before : QUICK_PICKUP_FROM
    return { disabledBefore: from, disabledAfter: QUICK_PICKUP_TO }
  }
  return { disabledBefore: before, disabledAfter: null }
}

/**
 * 반납일(returnDateIso)에서 선택 가능한 반납 시각 범위.
 * 반납일이 수령일과 같고 수령 시각이 정해져 있으면 그 시각 미만은 불가.
 */
export function returnTimeLimits(
  method: string | null | undefined,
  returnDateIso: string | null | undefined,
  pickupDateIso: string | null | undefined,
  pickupTime: string | null | undefined,
): TimeLimits {
  const family = familyOf(method)
  if (!family) return NO_TIME_LIMITS

  let before: string | null = null
  let after: string | null = null
  if (family === 'quick') {
    before = QUICK_RETURN_FROM
    after = QUICK_RETURN_TO
  }
  if (returnDateIso && pickupDateIso && returnDateIso === pickupDateIso && pickupTime) {
    if (before === null || pickupTime > before) before = pickupTime
  }
  return { disabledBefore: before, disabledAfter: after }
}

/** 시각 t('HH:MM')가 범위 안인가 — 비어 있으면 true(필수 여부는 호출부가 따로 본다) */
export function isTimeWithinLimits(limits: TimeLimits, t: string | null | undefined): boolean {
  if (!t) return true
  if (limits.disabledBefore !== null && t < limits.disabledBefore) return false
  if (limits.disabledAfter !== null && t > limits.disabledAfter) return false
  return true
}
