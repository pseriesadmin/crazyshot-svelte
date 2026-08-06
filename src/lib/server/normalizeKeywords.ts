// normalizeKeywords.ts — canned_responses.match_keywords 입력값 정규화 (서버 전용)
// trim / 빈값 제거 / 중복 제거 / 개수 제한, /api/cms/canned-responses POST·PATCH 공용

export const MAX_MATCH_KEYWORDS = 10

export function normalizeKeywords(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of input) {
    if (typeof raw !== 'string') continue
    const kw = raw.trim()
    if (!kw || seen.has(kw)) continue
    seen.add(kw)
    out.push(kw)
    if (out.length >= MAX_MATCH_KEYWORDS) break
  }
  return out
}
