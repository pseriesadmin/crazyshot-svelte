// 채팅창 '반납정보 등록하기' 안내바 — 어떤 대여 건에 언제부터 안내바를 띄울지 정하는 순수 규칙(2026-11-13, Stephen 지시).
// 기존 CMS 반납 정책을 그대로 따른다(새 정책을 만들지 않는다):
//   · 방문·퀵서비스·무인보관함 반납: 푸시알림 설정 '반납정보 등록요청'에서 방식별로 지정한 반납일 당일 시각(KST, 24:00=당일 23:50)부터. 그 방식의 값이 '없음'이면 안내하지 않는다(요청도 보내지 않는 방식).
//   · 택배류(우체국·배송·크레이지배송·공항) 반납: 방식별 단계 알림의 시작 시각인 반납일 당일 09:00(KST)부터(returnNotice.ts 머리 주석).
//   · 반납정보를 이미 등록한 건(고객 제출·관리자 대리 등록)과 등록 면제 건, 대여중·반납요청이 아닌 건은 제외.
//   · 시작 시각이 지나면 등록을 마칠 때까지 계속 띄운다(발송용 '1시간 이내' 상한은 알림 중복 방지용이라 안내바에는 쓰지 않는다).
import { isValidTimerTime, timerTimeToMinutes } from '$lib/utils/lockerGuideTimer'
import { resolveReturnSubmitMethod, returnSubmitPath } from '$lib/utils/returnNotice'

export const RETURN_REGISTER_TIMER_SETTING_KEY = 'return_registration_timer'
/** 택배류 반납 안내 시작 시각 — 반납일 당일 09:00 (분) */
export const COURIER_BAR_START_MINUTE = 9 * 60
const BAR_STATUSES = new Set(['in_use', 'return_requested'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface ReturnBarReservation {
  id: number
  end_date: string | null
  return_method: string | null
  status: string | null
  return_record_exempt?: boolean | null
}

/** 방식별 지정 시각('HH:MM') — 없으면 null. 옛 형식(숫자)·형식 오류는 null(보내지 않는 방식과 같은 취급) */
export interface ReturnBarTimer {
  visit: string | null
  quick: string | null
  locker: string | null
}

export const EMPTY_RETURN_BAR_TIMER: ReturnBarTimer = { visit: null, quick: null, locker: null }

export function parseReturnBarTimer(raw: unknown): ReturnBarTimer {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_RETURN_BAR_TIMER }
  const r = raw as Record<string, unknown>
  return {
    visit: isValidTimerTime(r.visit) ? r.visit : null,
    quick: isValidTimerTime(r.quick) ? r.quick : null,
    locker: isValidTimerTime(r.locker) ? r.locker : null,
  }
}

/** DB 조회 결과(알 수 없는 형태)에서 안내바 판정에 필요한 필드가 갖춰진 행만 골라 타입을 좁힌다 */
export function toReturnBarReservations(raw: unknown): ReturnBarReservation[] {
  if (!Array.isArray(raw)) return []
  const out: ReturnBarReservation[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const id = Number(o.id)
    if (!Number.isFinite(id)) continue
    out.push({
      id,
      end_date: typeof o.end_date === 'string' ? o.end_date : null,
      return_method: typeof o.return_method === 'string' ? o.return_method : null,
      status: typeof o.status === 'string' ? o.status : null,
      return_record_exempt: o.return_record_exempt === true,
    })
  }
  return out
}

export interface ReturnBarItem {
  reservationId: number
  href: string
  /** 안내를 시작하는 시각(ms) */
  startAtMs: number
}

/** 반납일(YYYY-MM-DD) 당일 0시(KST)부터 minutes 분 뒤의 시각(ms) */
function kstDayMinuteMs(endDate: string, minutes: number): number {
  return new Date(`${endDate}T00:00:00+09:00`).getTime() + minutes * 60_000
}

/**
 * 안내바에 띄울 대여 건 목록(시작 시각이 이른 것부터). registeredIds 는 반납 기록(고객 제출·관리자 대리)이 이미 있는 예약 id.
 */
export function pickReturnRegisterBarItems(
  rows: ReturnBarReservation[],
  registeredIds: ReadonlySet<number>,
  timer: ReturnBarTimer,
  nowMs: number,
): ReturnBarItem[] {
  const out: ReturnBarItem[] = []
  for (const r of rows) {
    if (!r.status || !BAR_STATUSES.has(r.status)) continue
    if (r.return_record_exempt === true) continue
    if (registeredIds.has(r.id)) continue
    if (!r.end_date || !DATE_RE.test(r.end_date)) continue
    const method = resolveReturnSubmitMethod(r.return_method)
    if (!method) continue
    let startMinute: number
    if (method === 'courier') {
      startMinute = COURIER_BAR_START_MINUTE
    } else {
      const t = method === 'visit' ? timer.visit : method === 'quick' ? timer.quick : timer.locker
      if (!t) continue
      startMinute = timerTimeToMinutes(t)
      if (startMinute < 0) continue
    }
    const startAtMs = kstDayMinuteMs(r.end_date, startMinute)
    if (!Number.isFinite(startAtMs) || nowMs < startAtMs) continue
    out.push({ reservationId: r.id, href: returnSubmitPath(r.id), startAtMs })
  }
  return out.sort((a, b) => a.startAtMs - b.startAtMs || a.reservationId - b.reservationId)
}
