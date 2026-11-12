// 마이페이지 대여 카드 — 무인보관함 정보(무인함 번호·비밀번호) 노출 판정(순수 함수, 서버 로더에서 호출).
// 크론 claim_reservations_due_for_locker_guide(Migration #787)와 같은 식:
//   수령 구간 = (start_date + pickup_time) − 1시간, 반납 구간 = (end_date + return_time) − 1시간 (KST).
//   locker_guide_legs: 'pickup'|'return'|'both'|NULL(=둘 다). pickup_time NULL 이면 수령 구간 없음.
// 노출 시각 이후에는 계속 참(별도 '노출됨' 저장 없음). 취소·만료·취소중이면 항상 null.
// 반납시각은 없거나 형식 오류면 18:00, 24:00 은 다음날 00:00(방문·퀵 반납 배송 케이스).

export interface LockerRowInput {
  id: string
  locker_number: string | null
  locker_password: string | null
  locker_guide_legs: string | null
}

export interface LockerInfo {
  number: string
  password: string
}

export interface ResolveLockerInfoInput {
  /** 같은 주문의 예약 행들(순서 무관) */
  rows: LockerRowInput[]
  status: string
  cancelling: boolean
  startDate: string | null
  endDate: string | null
  pickupTime: string | null
  returnTime: string | null
  now: Date
}

const HIDDEN_STATUSES = new Set(['cancelled', 'expired'])
const ONE_HOUR_MS = 60 * 60 * 1000
const DEFAULT_RETURN_MIN = 18 * 60
const TIME_RE = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/

function idNum(id: string): number {
  const n = Number(id)
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER
}

/** 하루 안의 분(0~1440). 24:00 은 1440 으로 허용하고, 형식 오류면 null */
function parseMinutes(time: string | null): number | null {
  const m = TIME_RE.exec((time ?? '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h === 24 && min === 0) return 1440
  if (h > 23) return null
  return h * 60 + min
}

function dayStartMs(date: string | null): number | null {
  const day = (date ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const ms = Date.parse(`${day}T00:00:00+09:00`)
  return Number.isNaN(ms) ? null : ms
}

function legsApply(legs: string | null): { pickup: boolean; ret: boolean } {
  if (legs === null) return { pickup: true, ret: true }
  if (legs === 'both') return { pickup: true, ret: true }
  if (legs === 'pickup') return { pickup: true, ret: false }
  if (legs === 'return') return { pickup: false, ret: true }
  return { pickup: false, ret: false }
}

function hasValue(v: string | null): v is string {
  return typeof v === 'string' && v.trim() !== ''
}

export function resolveLockerInfo(input: ResolveLockerInfoInput): LockerInfo | null {
  if (input.cancelling || HIDDEN_STATUSES.has(input.status)) return null

  // 번호·비밀번호가 둘 다 있는 첫 행(id 오름차순)의 세트가 주문의 세트
  const source = [...input.rows]
    .sort((a, b) => idNum(a.id) - idNum(b.id))
    .find(r => hasValue(r.locker_number) && hasValue(r.locker_password))
  if (!source || !hasValue(source.locker_number) || !hasValue(source.locker_password)) return null

  const applies = legsApply(source.locker_guide_legs)
  const candidates: number[] = []

  if (applies.pickup && input.pickupTime !== null) {
    const day = dayStartMs(input.startDate)
    const min = parseMinutes(input.pickupTime)
    if (day !== null && min !== null && min < 1440) candidates.push(day + min * 60_000 - ONE_HOUR_MS)
  }
  if (applies.ret) {
    const day = dayStartMs(input.endDate)
    const parsed = parseMinutes(input.returnTime)
    const min = parsed ?? DEFAULT_RETURN_MIN
    if (day !== null) candidates.push(day + min * 60_000 - ONE_HOUR_MS)
  }
  if (candidates.length === 0) return null

  const exposeAt = Math.min(...candidates)
  if (input.now.getTime() < exposeAt) return null
  return { number: source.locker_number.trim(), password: source.locker_password.trim() }
}
