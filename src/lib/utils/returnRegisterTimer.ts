// 반납정보 등록요청 '발송 시간(반납일 당일 HH:MM)' 규칙 (2026-11-13, Stephen 지시·확정) — 화면(푸시알림 설정)·서버(저장 검증·크론)가 같은 규칙을 쓴다. 순수 함수.
// 방문·퀵·무인보관함 반납 고객에게 반납일 당일의 지정 시각(KST, 01:00~24:00 · 10분 단위, 24:00=당일 23:50)에 '반납정보 등록요청'(채팅카드+푸시+문자)을 한 번 보낸다.
// 값이 없으면(없음) 그 방식은 보내지 않는다. 택배류 반납은 기존대로 [반납 접수] 전환 시 발송(이 타이머와 무관).
// 시각 규칙(형식·24:00 처리)은 무인보관함 안내 '추가 자동 발송 시간'과 같은 lockerGuideTimer 규칙을 쓴다.
// 옛 형식(#822 초기 — '반납 시각 N시간 전' 숫자)으로 저장된 값은 반납일 당일 시각으로 바꿀 수 없어 '없음'으로 읽는다.

import { isValidTimerTime, parseTimerValue } from '$lib/utils/lockerGuideTimer'

export const RETURN_REGISTER_TIMER_KEY = 'return_registration_timer'

export type ReturnRegisterLeg = 'visit' | 'quick' | 'locker'

export const RETURN_REGISTER_LEGS: ReturnRegisterLeg[] = ['visit', 'quick', 'locker']

export const RETURN_REGISTER_LEG_LABEL: Record<ReturnRegisterLeg, string> = {
  visit: '방문 반납',
  quick: '퀵서비스 반납',
  locker: '무인보관함 반납',
}

export interface ReturnRegisterTimer {
  /** 반납일 당일 발송 시각 'HH:MM'(KST), 없으면 null(보내지 않음) */
  visit: string | null
  quick: string | null
  locker: string | null
}

export const EMPTY_RETURN_REGISTER_TIMER: ReturnRegisterTimer = { visit: null, quick: null, locker: null }

export function isReturnRegisterLeg(v: unknown): v is ReturnRegisterLeg {
  return v === 'visit' || v === 'quick' || v === 'locker'
}

/** 화면 선택 값('', 'HH:MM')을 검증한다. ''는 null(= 보내지 않음), 형식·범위 오류는 undefined. */
export const parseReturnRegisterTime = parseTimerValue

/** 저장소(cms_settings.value)에서 읽은 값을 안전하게 해석한다. 형식이 어긋난 칸(옛 숫자 포함)은 null. */
export function parseReturnRegisterTimer(raw: unknown): ReturnRegisterTimer {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_RETURN_REGISTER_TIMER }
  const r = raw as Record<string, unknown>
  return {
    visit: isValidTimerTime(r.visit) ? r.visit : null,
    quick: isValidTimerTime(r.quick) ? r.quick : null,
    locker: isValidTimerTime(r.locker) ? r.locker : null,
  }
}
