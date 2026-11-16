/** 고객 상품 카드(썸네일과 상품명 사이)에 라운드 바로 노출할 키워드 — CMS 상품설명 키워드 중 선택한 것 */
export const MAX_CARD_KEYWORDS = 3

/** DB 값(products.card_keywords) → 문자열 배열 */
export function parseCardKeywords(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string' && v.trim() !== '').slice(0, MAX_CARD_KEYWORDS)
}

/** 저장 전 검증 — 등록된 키워드 안의 값만, 중복 제거, 최대 개수 */
export function sanitizeCardKeywords(selected: unknown, keywords: string[]): string[] {
  if (!Array.isArray(selected)) return []
  const out: string[] = []
  for (const v of selected) {
    if (typeof v !== 'string' || v === '' || !keywords.includes(v) || out.includes(v)) continue
    out.push(v)
    if (out.length >= MAX_CARD_KEYWORDS) break
  }
  return out
}

export function toggleCardKeyword(selected: string[], kw: string): { next: string[]; limited: boolean } {
  if (selected.includes(kw)) return { next: selected.filter((k) => k !== kw), limited: false }
  if (selected.length >= MAX_CARD_KEYWORDS) return { next: selected, limited: true }
  return { next: [...selected, kw], limited: false }
}
