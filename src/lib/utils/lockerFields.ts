/**
 * 무인보관함 배정정보 입력 규칙 (2026-10-08, Stephen 확정) — 무인함 번호·비밀번호 모두 "숫자·특수문자만" 허용(영문·한글·공백 불가).
 * 허용 문자 = 숫자 0-9 + ASCII 특수문자(! " # $ % & ' ( ) * + , - . / : ; < = > ? @ [ \ ] ^ _ ` { | } ~).
 * 서버 검증과 화면 입력 정리가 같은 규칙을 쓰도록 이 파일 하나에 둔다.
 */
const ALLOWED_CHAR = /[0-9!-/:-@[-`{-~]/
const DISALLOWED_CHARS = /[^0-9!-/:-@[-`{-~]/g

/** 허용 문자(숫자·특수문자)만 남긴다 — 영문·한글·공백·기타 문자는 제거 */
export function sanitizeLockerInput(value: string): string {
  return value.replace(DISALLOWED_CHARS, '')
}

export const LOCKER_NUMBER_MAX = 10
export const LOCKER_PASSWORD_MIN = 4
export const LOCKER_PASSWORD_MAX = 10

function onlyAllowed(value: string): boolean {
  return value.length > 0 && [...value].every(ch => ALLOWED_CHAR.test(ch))
}

/** 무인함 번호: 1~10자, 숫자·특수문자만 */
export function isValidLockerNumber(value: string): boolean {
  return value.length >= 1 && value.length <= LOCKER_NUMBER_MAX && onlyAllowed(value)
}

/** 비밀번호: 4~10자, 숫자·특수문자만 */
export function isValidLockerPassword(value: string): boolean {
  return value.length >= LOCKER_PASSWORD_MIN && value.length <= LOCKER_PASSWORD_MAX && onlyAllowed(value)
}

/**
 * 무인보관함 안내 발송 대상(2026-10-31, Migration #787) — 관리자가 [수령]·[반납] 콤보 버튼으로 직접 고른다.
 * 저장값: 'pickup'(수령 때만) | 'return'(반납 때만) | 'both'(수령·반납 둘 다). DB NULL = 옛 저장분(둘 다 발송).
 */
export type LockerGuideLegs = 'pickup' | 'return' | 'both'
export type LockerGuideLeg = 'pickup' | 'return'

export const LOCKER_GUIDE_LEGS_ERROR = '안내 발송 대상(수령·반납)을 선택해 주세요.'

export function isValidLockerGuideLegs(value: unknown): value is LockerGuideLegs {
  return value === 'pickup' || value === 'return' || value === 'both'
}

/** 콤보 버튼 두 개의 선택 → 저장값. 둘 다 꺼져 있으면(아직 고르지 않음) null */
export function legsFromSelection(pickup: boolean, ret: boolean): LockerGuideLegs | null {
  if (pickup && ret) return 'both'
  if (pickup) return 'pickup'
  if (ret) return 'return'
  return null
}

/** 저장값 → 콤보 버튼 두 개의 선택. NULL·알 수 없는 값은 아무것도 선택하지 않은 상태 */
export function selectionFromLegs(legs: string | null | undefined): { pickup: boolean; return: boolean } {
  return { pickup: legs === 'pickup' || legs === 'both', return: legs === 'return' || legs === 'both' }
}

/** 저장값 → 발송 단계 목록(수령 → 반납 순서) */
export function legListFromLegs(legs: LockerGuideLegs): LockerGuideLeg[] {
  return legs === 'both' ? ['pickup', 'return'] : [legs]
}

export const LOCKER_NUMBER_ERROR = '무인함 번호는 1~10자의 숫자·특수문자만 입력할 수 있습니다.'
export const LOCKER_PASSWORD_ERROR = '보관함 비밀번호는 4~10자의 숫자·특수문자만 입력할 수 있습니다.'
