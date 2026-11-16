// 상품에 노출할 배지 판정 — 대상(상품 직접 ∪ 카테고리)·노출기간·활성·우선순위 정렬.
// 고객 화면용 DB 함수(get_product_badges)와 같은 규칙이다 — 함께 바꾼다(실서비스 판정은 DB 함수, 이 함수는 규칙의 기준 사본·시험용).
// 템플릿 활성·삭제 조건은 DB 함수에서만 판정한다(이 함수는 규칙 단위만 받음).
// 배지목록 1개에 배지타입을 여러 개 연결할 수 있다(Migration #830) — 카드·상세는 개수 상한 없이 전부 표시한다(2026-11-16, Stephen 확정).
// 이 함수는 "배지목록 단위" 판정이라 배지타입 개수와 무관하다(고객용 DB 함수 get_product_badges 가 배지목록을 배지타입별로 펼친다).

export interface BadgeRuleForResolve {
  id: string
  priority: number
  valid_from: string | null
  valid_until: string | null
  is_active: boolean
  product_ids: string[]
  categories: string[]
}

function ts(v: string | null): number | null {
  if (!v) return null
  const n = Date.parse(v)
  return Number.isNaN(n) ? null : n
}

export function resolveBadges<T extends BadgeRuleForResolve>(
  rules: T[],
  target: { productId: string; category: string | null },
  now: Date = new Date(),
  limit?: number
): T[] {
  const t = now.getTime()
  const hits = rules.filter((r) => {
    if (!r.is_active) return false
    const from = ts(r.valid_from)
    const until = ts(r.valid_until)
    if (from !== null && from > t) return false
    if (until !== null && until < t) return false
    if (r.product_ids.includes(target.productId)) return true
    return target.category !== null && r.categories.includes(target.category)
  })
  hits.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    const fa = ts(a.valid_from) ?? Number.NEGATIVE_INFINITY
    const fb = ts(b.valid_from) ?? Number.NEGATIVE_INFINITY
    if (fa !== fb) return fa - fb
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return typeof limit === 'number' ? hits.slice(0, limit) : hits
}
