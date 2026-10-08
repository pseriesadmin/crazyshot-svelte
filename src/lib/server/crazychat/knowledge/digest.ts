// digest.ts — 크레이지챗 지식 저장소의 요약본 생성(순수 함수, 서버 전용)
// 4개 재료 → AI가 읽기 좋은 작은 JSON. 개인정보 원칙: 고객 식별 정보와 후기 원문은 요약본에 넣지 않는다(집계·단어 빈도만).
import { createHash } from 'node:crypto'
import { maskPersonalInfo } from '../assist/mask'

export type KnowledgeSource = 'faq' | 'product' | 'review' | 'reservation'

const inc = (m: Record<string, number>, k: string | null | undefined): void => { const key = (k ?? '').trim() || '(없음)'; m[key] = (m[key] ?? 0) + 1 }
const id8 = (id: string): string => id.slice(0, 8)

// ── 빠른답변 ────────────────────────────────────────────────────────────────
export interface FaqRow { id: string; title: string | null; category: string | null; shortcut: string | null; match_keywords: string[] | null; usage_count: number | null }
export interface FaqDigest {
  count: number
  keywordTotal: number
  byCategory: Record<string, number>
  noKeyword: string[]
  thinKeyword: string[]
  topUsed: { id: string; title: string; usage: number }[]
  faqs: { id: string; title: string; category: string | null; keywordCount: number; usage: number }[]
}
const THIN_KEYWORDS = 3

export function buildFaqDigest(rows: readonly FaqRow[]): FaqDigest {
  const byCategory: Record<string, number> = {}
  const noKeyword: string[] = []
  const thinKeyword: string[] = []
  let keywordTotal = 0
  const faqs = rows.map((r) => {
    const kc = (r.match_keywords ?? []).length
    keywordTotal += kc
    inc(byCategory, r.category)
    if (kc === 0) noKeyword.push(id8(r.id))
    if (kc < THIN_KEYWORDS) thinKeyword.push(id8(r.id))
    return { id: id8(r.id), title: r.title ?? '', category: r.category, keywordCount: kc, usage: r.usage_count ?? 0 }
  })
  const topUsed = [...faqs].filter((f) => f.usage > 0).sort((a, b) => b.usage - a.usage).slice(0, 5).map((f) => ({ id: f.id, title: f.title, usage: f.usage }))
  return { count: rows.length, keywordTotal, byCategory, noKeyword, thinKeyword, topUsed, faqs }
}

// ── 상품 색인 ───────────────────────────────────────────────────────────────
export interface ProductRow {
  id: string; name: string | null; brand: string | null; category: string | null; keywords: string[] | null
  product_caption: string | null; specifications: unknown; components: unknown; sale_only: boolean | null
}
export interface ProductDigest {
  count: number
  byCategory: Record<string, number>
  brands: { brand: string; count: number }[]
  saleOnly: number
  noKeywords: number
  noSpecs: number
  noComponents: number
  thinProducts: { id: string; name: string }[]
}
const isEmptyKv = (v: unknown): boolean => v === null || v === undefined || (Array.isArray(v) ? v.length === 0 : typeof v === 'object' ? Object.keys(v as object).length === 0 : true)

export function buildProductDigest(rows: readonly ProductRow[]): ProductDigest {
  const byCategory: Record<string, number> = {}
  const brandCount: Record<string, number> = {}
  const thin: { id: string; name: string }[] = []
  let saleOnly = 0, noKeywords = 0, noSpecs = 0, noComponents = 0
  for (const r of rows) {
    inc(byCategory, r.category)
    if (r.brand && r.brand.trim()) inc(brandCount, r.brand)
    if (r.sale_only) saleOnly++
    const noKw = !r.keywords || r.keywords.length === 0
    const noCap = !r.product_caption || !r.product_caption.trim()
    const noSp = isEmptyKv(r.specifications)
    const noCo = isEmptyKv(r.components)
    if (noKw) noKeywords++
    if (noSp) noSpecs++
    if (noCo) noComponents++
    if (noKw && noCap && noSp) thin.push({ id: r.id, name: r.name ?? '' })
  }
  const brands = Object.entries(brandCount).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 30).map(([brand, count]) => ({ brand, count }))
  return { count: rows.length, byCategory, brands, saleOnly, noKeywords, noSpecs, noComponents, thinProducts: thin.slice(0, 50) }
}

// ── 상품 후기 ───────────────────────────────────────────────────────────────
export interface ReviewRow { product_id: string; title: string | null; content: string | null }
export interface ReviewDigest {
  count: number
  productsWithReviews: number
  perProduct: { productId: string; count: number }[]
  topTerms: { term: string; count: number }[]
}
const REVIEW_STOP = new Set(['정말', '너무', '아주', '진짜', '그리고', '그런데', '하지만', '조금', '매우', '합니다', '했어요', '있어요', '좋아요', '같아요', '입니다', '이용', '대여', '감사'])

export function buildReviewDigest(rows: readonly ReviewRow[]): ReviewDigest {
  const per: Record<string, number> = {}
  const terms: Record<string, number> = {}
  for (const r of rows) {
    per[r.product_id] = (per[r.product_id] ?? 0) + 1
    // 원문은 마스킹 후 단어 빈도만 남기고 즉시 버린다
    const text = maskPersonalInfo(`${r.title ?? ''} ${r.content ?? ''}`)
    const seen = new Set<string>()
    for (const raw of text.split(/[\s,.!?~·/()'"“”‘’\[\]{}:;]+/)) {
      const t = raw.replace(/(이|가|은|는|을|를|도|에|의|로|으로|요|네|서)$/, '')
      if (t.length < 2 || !/[가-힣a-zA-Z]/.test(t) || /^\[/.test(t) || REVIEW_STOP.has(t) || seen.has(t)) continue
      seen.add(t)
      terms[t] = (terms[t] ?? 0) + 1
    }
  }
  const perProduct = Object.entries(per).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([productId, count]) => ({ productId, count }))
  const topTerms = Object.entries(terms).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 30).map(([term, count]) => ({ term, count }))
  return { count: rows.length, productsWithReviews: Object.keys(per).length, perProduct, topTerms }
}

// ── 고객 예약(집계 전용) ─────────────────────────────────────────────────────
export interface ReservationRow {
  status: string | null; pickup_method: string | null; return_method: string | null; duration_type: string | null
  start_date: string | null; end_date: string | null; created_at: string | null
  product_id?: string | number | null
}
export interface ReservationDigest {
  count: number
  byStatus: Record<string, number>
  byPickup: Record<string, number>
  byReturn: Record<string, number>
  byDuration: Record<string, number>
  monthly: Record<string, number>
  last30d: number
  avgRentalDays: number
  /** 최근 90일, 취소·만료 제외, 상품별 예약 건수(개인 식별 정보 없음) */
  popularProducts: { productId: string; count: number }[]
}
export function buildReservationDigest(rows: readonly ReservationRow[], now: Date): ReservationDigest {
  const byStatus: Record<string, number> = {}, byPickup: Record<string, number> = {}, byReturn: Record<string, number> = {}, byDuration: Record<string, number> = {}, monthly: Record<string, number> = {}
  let last30d = 0, daySum = 0, dayN = 0
  const popular: Record<string, number> = {}
  const since90 = now.getTime() - 90 * 24 * 3600_000
  const since = now.getTime() - 30 * 24 * 3600_000
  for (const r of rows) {
    inc(byStatus, r.status); inc(byPickup, r.pickup_method); inc(byReturn, r.return_method); inc(byDuration, r.duration_type)
    if (r.created_at) {
      const t = Date.parse(r.created_at)
      if (!Number.isNaN(t)) {
        if (t >= since) last30d++
        inc(monthly, r.created_at.slice(0, 7))
      }
    }
    if (r.product_id !== undefined && r.product_id !== null && r.status !== 'cancelled' && r.status !== 'expired' && r.created_at && Date.parse(r.created_at) >= since90) {
      const k = String(r.product_id)
      popular[k] = (popular[k] ?? 0) + 1
    }
    if (r.start_date && r.end_date) {
      const d = (Date.parse(r.end_date) - Date.parse(r.start_date)) / 86_400_000
      if (!Number.isNaN(d) && d >= 0) { daySum += d + 1; dayN++ }
    }
  }
  const popularProducts = Object.entries(popular).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20).map(([productId, count]) => ({ productId, count }))
  return { count: rows.length, byStatus, byPickup, byReturn, byDuration, monthly, last30d, avgRentalDays: dayN ? Math.round((daySum / dayN) * 10) / 10 : 0, popularProducts }
}

/** 예약의 product_id는 재고 단위(자식)일 수 있다 — 부모 상품 id로 바꿔 같은 상품의 재고들이 한 상품으로 집계되게 한다(부모/모르는 id는 그대로) */
export function resolveParentIds<T extends { product_id?: string | number | null }>(rows: readonly T[], parentOf: ReadonlyMap<string, string | null>): T[] {
  return rows.map((r) => {
    if (r.product_id === undefined || r.product_id === null) return r
    const parent = parentOf.get(String(r.product_id))
    return parent ? { ...r, product_id: parent } : r
  })
}

// ── 지문 ────────────────────────────────────────────────────────────────────
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]))
  return v
}
export function digestHash(digest: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(digest))).digest('hex')
}
