// 반납정보 등록요청 '발송 시간(반납 시각 N시간 전)' 규칙 (2026-11-13, Stephen 지시) — 화면(푸시알림 설정)·서버(저장 검증·크론)가 같은 규칙을 쓴다. 순수 함수.
// 방문·퀵·무인보관함 반납 고객에게 반납 예정 일시(end_date + return_time, KST)의 N시간 전에 '반납정보 등록요청'(채팅카드+푸시+문자)을 한 번 보낸다.
// 값이 없으면(설정 안 함) 그 방식은 보내지 않는다. 택배류 반납은 기존대로 [반납 접수] 전환 시 발송(이 타이머와 무관).

export const RETURN_REGISTER_TIMER_KEY = 'return_registration_timer'
export const RETURN_REGISTER_MIN_HOURS = 1
export const RETURN_REGISTER_MAX_HOURS = 24

export type ReturnRegisterLeg = 'visit' | 'quick' | 'locker'

export const RETURN_REGISTER_LEGS: ReturnRegisterLeg[] = ['visit', 'quick', 'locker']

export const RETURN_REGISTER_LEG_LABEL: Record<ReturnRegisterLeg, string> = {
  visit: '방문 반납',
  quick: '퀵서비스 반납',
  locker: '무인보관함 반납',
}

export interface ReturnRegisterTimer {
  /** 반납 시각 몇 시간 전에 보낼지(1~24), 없으면 null(보내지 않음) */
  visit: number | null
  quick: number | null
  locker: number | null
}

export const EMPTY_RETURN_REGISTER_TIMER: ReturnRegisterTimer = { visit: null, quick: null, locker: null }

export function isReturnRegisterLeg(v: unknown): v is ReturnRegisterLeg {
  return v === 'visit' || v === 'quick' || v === 'locker'
}

export function isValidReturnRegisterHours(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= RETURN_REGISTER_MIN_HOURS && v <= RETURN_REGISTER_MAX_HOURS
}

/** 화면 선택 값('', '1'~'24')을 시간 수로. ''는 null(= 보내지 않음), 형식·범위 오류는 undefined. */
export function parseReturnRegisterHours(value: unknown): number | null | undefined {
  if (value === '' || value === null) return null
  if (typeof value !== 'string' || !/^\d{1,2}$/.test(value)) return undefined
  const h = Number(value)
  return isValidReturnRegisterHours(h) ? h : undefined
}

/** 선택 칸 표기 — 값 없음은 '설정 안 함', 있으면 'N시간 전' */
export function returnRegisterLabel(hours: number | null): string {
  return hours === null ? '설정 안 함' : `${hours}시간 전`
}

/** 저장소(cms_settings.value)에서 읽은 값을 안전하게 해석한다. 형식이 어긋난 칸은 null. */
export function parseReturnRegisterTimer(raw: unknown): ReturnRegisterTimer {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_RETURN_REGISTER_TIMER }
  const r = raw as Record<string, unknown>
  return {
    visit: isValidReturnRegisterHours(r.visit) ? r.visit : null,
    quick: isValidReturnRegisterHours(r.quick) ? r.quick : null,
    locker: isValidReturnRegisterHours(r.locker) ? r.locker : null,
  }
}
