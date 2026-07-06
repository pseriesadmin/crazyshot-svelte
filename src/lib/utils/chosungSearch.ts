/**
 * chosungSearch.ts — 한글 초성 + 영문 + 품번 검색 유틸
 * 재사용: 모바일 앱 상품 검색, CMS 이력관리 랜딩 등
 */

const CHO_SEONG = [
  'ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ',
  'ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ',
]

/**
 * 한글 문자에서 초성을 추출합니다.
 * 한글이 아닌 문자는 그대로 반환합니다.
 */
function extractChosung(char: string): string {
  const code = char.charCodeAt(0)
  if (code < 0xAC00 || code > 0xD7A3) return char
  const offset = code - 0xAC00
  const choIdx = Math.floor(offset / 28 / 21)
  return CHO_SEONG[choIdx] ?? char // eslint-disable-line security/detect-object-injection
}

/**
 * 문자열의 초성 시퀀스를 반환합니다.
 * 예: "소니 A7IV" → "ㅅㄴ a7iv"
 */
function toChosung(text: string): string {
  return text
    .split('')
    .map(extractChosung)
    .join('')
    .toLowerCase()
}

/**
 * 상품이 검색어와 매칭되는지 확인합니다.
 *
 * 매칭 방법 (OR):
 * 1. 상품명 소문자 포함 매칭
 * 2. 상품명 초성 포함 매칭 (한글 자음 입력 시)
 * 3. 품번 소문자 포함 매칭
 */
export function matchesSearch(
  item: { name: string; product_code: string | null },
  query: string
): boolean {
  if (!query.trim()) return true

  const q = query.toLowerCase().trim()
  const nameLower = item.name.toLowerCase()
  const codeLower = (item.product_code ?? '').toLowerCase()
  const nameChosung = toChosung(item.name)
  const qChosung = toChosung(query.trim())

  return (
    nameLower.includes(q) ||
    nameChosung.includes(qChosung) ||
    codeLower.includes(q)
  )
}
