// 새 비밀번호 입력 규칙(클라이언트 공용) — 메인 비밀번호 찾기(문자 인증, $lib/server/legacyClaim validateNewPassword)와 같은 규칙 (2026-10-23)
// 6~72자, 영문·숫자·특수문자(ASCII 출력 문자)만. 로그인 입력란이 한글을 지우므로(front-uiux.md §21) 한글이 섞인 비밀번호는 만들 수 없게 한다.
// 서버 규칙을 바꾸면 이 파일도 함께 바꾼다 — passwordPolicy.test.ts 가 두 규칙의 일치를 검사한다.
export const PASSWORD_MIN = 6
export const PASSWORD_MAX = 72

/** 입력 중인 비밀번호에서 허용되지 않는 문자(한글·공백·이모지 등)를 지운다. removed 는 지운 문자가 있었는지 */
export function sanitizePasswordInput(raw: string): { value: string; removed: boolean } {
  const value = raw.replace(/[^\x21-\x7E]/g, '')
  return { value, removed: value !== raw }
}

/** 새 비밀번호 + 확인 입력 검증 — 문제가 있으면 안내 문구, 없으면 null */
export function validateNewPasswordInput(password: string, confirm: string): string | null {
  if (!password) return '비밀번호를 입력해 주세요.'
  if (password.length < PASSWORD_MIN) return `비밀번호는 ${PASSWORD_MIN}자 이상이어야 해요.`
  if (password.length > PASSWORD_MAX) return `비밀번호는 ${PASSWORD_MAX}자 이하여야 해요.`
  if (/[^\x21-\x7E]/.test(password)) return '비밀번호는 영문·숫자·특수문자만 사용할 수 있어요.'
  if (password !== confirm) return '비밀번호가 일치하지 않습니다.'
  return null
}
