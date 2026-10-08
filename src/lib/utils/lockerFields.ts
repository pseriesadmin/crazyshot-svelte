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

export const LOCKER_NUMBER_ERROR = '무인함 번호는 1~10자의 숫자·특수문자만 입력할 수 있습니다.'
export const LOCKER_PASSWORD_ERROR = '보관함 비밀번호는 4~10자의 숫자·특수문자만 입력할 수 있습니다.'
