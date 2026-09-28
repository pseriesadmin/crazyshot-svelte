/** 관심 키워드 pill/chip UI 노출 최대 글자 수(한·영·숫자·특수문자 각 1자) */
export const KEYWORD_LABEL_MAX_LEN = 10

/**
 * 키워드 pill 표시용 — 원문 검색·링크에는 full text 사용, UI만 잘라 표시
 */
export function truncateKeywordLabel(text: string, maxLen = KEYWORD_LABEL_MAX_LEN): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const chars = [...trimmed]
  if (chars.length <= maxLen) return trimmed
  return `${chars.slice(0, maxLen).join('')}…`
}
