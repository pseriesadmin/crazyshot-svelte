/**
 * searchEval.ts — 상품 검색 인덱스 전·후 비교용 평가 도구 (순수 함수, DB·$env 없음)
 * 용도: productSearchEvalLive.test.ts(실데이터 수동 실행)가 질의 세트를 돌려 지표를 출력한다.
 * 지표 정의는 개선 전·후가 동일해야 비교가 의미 있다 — 정의를 바꾸면 전(前) 기준값도 다시 측정할 것.
 */

import rawQueries from '../fixtures/nlsearchEvalQueries.json'

export interface EvalDoc { id: string; name: string; category: string }
export interface EvalHit { id: string; score: number }
/** 질의(또는 고객 문장)를 받아 점수순 결과를 돌려준다. 문장이면 호출 측에서 검색어 추출을 포함한다. */
export type EvalSearch = (query: string) => EvalHit[]

export interface CategoryQuery { q: string; expectCats: string[] }
export interface ModelQuery { q: string; nameRe: RegExp }

export type EvalQueryType = 'category' | 'direct' | 'model' | 'free' | 'relevant' | 'unanswerable'
/** 외부화된 평가 질의 1건(fixtures/nlsearchEvalQueries.json). relevantIds는 A-2 이후 recall/MRR 지표용(선택). */
export interface EvalQuery {
  q: string
  type: EvalQueryType
  expectCats?: string[]
  nameRe?: RegExp
  /** relevant 유형: 상품 이름이 이 정규식과 맞으면 정답(expectCats와 함께 쓰면 둘 중 하나만 맞아도 정답) */
  relevantRe?: RegExp
  relevantIds?: string[]
  /** 지표를 묶어 보기 위한 분류 이름(문장형·브랜드 등) */
  group?: string
}

const QUERY_TYPES: readonly EvalQueryType[] = ['category', 'direct', 'model', 'free', 'relevant', 'unanswerable']

/** JSON 원본을 검증해 EvalQuery로 변환한다(nameRe 문자열 → RegExp). 잘못된 항목은 즉시 예외. */
export function parseEvalQueries(raw: unknown): EvalQuery[] {
  if (!Array.isArray(raw)) throw new Error('평가 질의 세트는 배열이어야 합니다')
  return raw.map((item, i) => {
    const o = (item ?? {}) as Record<string, unknown>
    const q = typeof o.q === 'string' ? o.q.trim() : ''
    if (!q) throw new Error(`평가 질의 #${i}: q가 비어 있습니다`)
    const type = o.type as EvalQueryType
    if (!QUERY_TYPES.includes(type)) throw new Error(`평가 질의 #${i}("${q}"): 알 수 없는 type`)
    const out: EvalQuery = { q, type }
    if (type === 'category' || type === 'direct') {
      if (!Array.isArray(o.expectCats) || o.expectCats.length === 0 || !o.expectCats.every((c) => typeof c === 'string'))
        throw new Error(`평가 질의 #${i}("${q}"): ${type}은 expectCats가 필요합니다`)
      out.expectCats = o.expectCats as string[]
    }
    if (type === 'model') {
      if (typeof o.nameRe !== 'string' || !o.nameRe) throw new Error(`평가 질의 #${i}("${q}"): model은 nameRe가 필요합니다`)
      out.nameRe = new RegExp(o.nameRe)
    }
    if (type === 'relevant') {
      const hasCats = Array.isArray(o.expectCats) && o.expectCats.length > 0 && o.expectCats.every((c) => typeof c === 'string')
      const hasRe = typeof o.relevantRe === 'string' && o.relevantRe.length > 0
      if (!hasCats && !hasRe) throw new Error(`평가 질의 #${i}("${q}"): relevant는 expectCats 또는 relevantRe가 필요합니다`)
      if (hasCats) out.expectCats = o.expectCats as string[]
      if (hasRe) out.relevantRe = new RegExp(o.relevantRe as string, 'i')
    }
    if (typeof o.group === 'string' && o.group) out.group = o.group
    if (Array.isArray(o.relevantIds)) out.relevantIds = o.relevantIds.filter((x): x is string => typeof x === 'string')
    return out
  })
}

export const DEFAULT_EVAL_QUERIES: readonly EvalQuery[] = parseEvalQueries(rawQueries)

const pick = (type: EvalQueryType): EvalQuery[] => DEFAULT_EVAL_QUERIES.filter((x) => x.type === type)
const toCat = (xs: EvalQuery[]): CategoryQuery[] => xs.map((x) => ({ q: x.q, expectCats: x.expectCats ?? [] }))

/** 분류가 분명한 질의 — 상위 3개가 기대 분류인지 본다 */
export const CATEGORY_QUERIES: readonly CategoryQuery[] = toCat(pick('category'))
/** 액세서리 등 직접 질의 — 개선 후에도 해당 분류가 상위 3개에 유지돼야 한다(회귀 지표) */
export const DIRECT_QUERIES: readonly CategoryQuery[] = toCat(pick('direct'))
/** 모델명·브랜드 정확 질의 — 1위가 그 상품이어야 한다(회귀 지표) */
export const MODEL_QUERIES: readonly ModelQuery[] = pick('model').map((x) => ({ q: x.q, nameRe: x.nameRe as RegExp }))
/** 참고용(기대 없음) — 순위만 출력 */
export const FREE_QUERIES: readonly string[] = pick('free').map((x) => x.q)

export interface EvalReport {
  /** "카메라"/"렌즈" 단독 검색에서 해당 분류 상품이 몇 개나 잡혔나 */
  recall: { camera: { found: number; total: number }; lens: { found: number; total: number } }
  /** 분류 질의 상위3 적합: 상위 3개가 전부 기대 분류인 질의 수 / 전체 */
  categoryTop3: { ok: number; total: number; failed: string[] }
  categoryTop1: { ok: number; total: number }
  directTop3: { ok: number; total: number; failed: string[] }
  modelTop1: { ok: number; total: number; failed: string[] }
  maxScore: number
  lines: string[]
}

export function evaluate(
  docs: readonly EvalDoc[],
  search: EvalSearch,
  searchWide: EvalSearch,
  queries: readonly EvalQuery[] = DEFAULT_EVAL_QUERIES,
): EvalReport {
  const categoryQueries = toCat(queries.filter((x) => x.type === 'category'))
  const directQueries = toCat(queries.filter((x) => x.type === 'direct'))
  const modelQueries = queries.filter((x) => x.type === 'model').map((x) => ({ q: x.q, nameRe: x.nameRe as RegExp }))
  const freeQueries = queries.filter((x) => x.type === 'free').map((x) => x.q)
  const byId = new Map(docs.map((d) => [d.id, d]))
  const catOf = (id: string): string => byId.get(id)?.category ?? '?'
  const nameOf = (id: string): string => byId.get(id)?.name ?? '?'
  const lines: string[] = []

  const total = (c: string): number => docs.filter((d) => d.category === c).length
  const found = (q: string, c: string): number => searchWide(q).filter((h) => catOf(h.id) === c).length
  const recall = {
    camera: { found: found('카메라', 'camera'), total: total('camera') },
    lens: { found: found('렌즈', 'lens'), total: total('lens') },
  }

  let maxScore = 0
  const runCats = (items: readonly CategoryQuery[], label: string): { ok: number; top1: number; failed: string[] } => {
    let ok = 0
    let top1 = 0
    const failed: string[] = []
    lines.push(`\n[${label}]`)
    for (const it of items) {
      const hits = search(it.q)
      if (hits[0]) maxScore = Math.max(maxScore, hits[0].score)
      const top3 = hits.slice(0, 3)
      const pass = top3.length > 0 && top3.every((h) => it.expectCats.includes(catOf(h.id)))
      if (pass) ok++
      else failed.push(it.q)
      if (hits[0] && it.expectCats.includes(catOf(hits[0].id))) top1++
      lines.push(`  ${pass ? 'O' : 'X'} "${it.q.length > 28 ? it.q.slice(0, 28) + '…' : it.q}" 기대[${it.expectCats.join('|')}] → ${top3.map((h) => `[${catOf(h.id)}] ${nameOf(h.id)}`).join(' / ') || '(없음)'}`)
    }
    return { ok, top1, failed }
  }
  const cat = runCats(categoryQueries, '분류 질의 상위3')
  const direct = runCats(directQueries, '직접 질의(회귀)')

  lines.push('\n[모델명 정확 질의 1위]')
  let modelOk = 0
  const modelFailed: string[] = []
  for (const it of modelQueries) {
    const top = search(it.q)[0]
    const pass = !!top && it.nameRe.test(nameOf(top.id).trim())
    if (pass) modelOk++
    else modelFailed.push(it.q)
    lines.push(`  ${pass ? 'O' : 'X'} "${it.q}" → ${top ? nameOf(top.id) : '(없음)'}`)
  }

  lines.push('\n[참고(기대 없음)]')
  for (const q of freeQueries) lines.push(`  "${q}" → ${search(q).slice(0, 4).map((h) => `[${catOf(h.id)}] ${nameOf(h.id)}`).join(' / ') || '(없음)'}`)

  return {
    recall,
    categoryTop3: { ok: cat.ok, total: categoryQueries.length, failed: cat.failed },
    categoryTop1: { ok: cat.top1, total: categoryQueries.length },
    directTop3: { ok: direct.ok, total: directQueries.length, failed: direct.failed },
    modelTop1: { ok: modelOk, total: modelQueries.length, failed: modelFailed },
    maxScore,
    lines,
  }
}

export function formatSummary(r: EvalReport): string {
  return [
    `카메라 재현율 ${r.recall.camera.found}/${r.recall.camera.total} · 렌즈 재현율 ${r.recall.lens.found}/${r.recall.lens.total}`,
    `분류 질의 상위3 적합 ${r.categoryTop3.ok}/${r.categoryTop3.total} · 상위1 적합 ${r.categoryTop1.ok}/${r.categoryTop1.total}`,
    `직접 질의 상위3 유지 ${r.directTop3.ok}/${r.directTop3.total}${r.directTop3.failed.length ? ` (실패: ${r.directTop3.failed.join(', ')})` : ''}`,
    `모델명 1위 유지 ${r.modelTop1.ok}/${r.modelTop1.total}${r.modelTop1.failed.length ? ` (실패: ${r.modelTop1.failed.join(', ')})` : ''}`,
    `질의 1위 점수 최댓값 ${r.maxScore.toFixed(1)}`,
  ].join('\n')
}

// ── 순위 지표 (A-2): recall@K · MRR · nDCG@K · 0건 비율 ─────────────────────────────

export interface RankingMetrics {
  /** 채점 질의 수 */
  n: number
  /** 정답 중 상위 K에 든 비율(분모는 min(K, 정답 수) — 정답이 K보다 많으면 K까지만 요구) */
  recallAtK: number
  /** 첫 정답 순위의 역수 평균(정답이 없으면 0) */
  mrr: number
  ndcgAtK: number
  /** 결과가 0건인 질의 비율(정답이 있는 질의만) */
  zeroRate: number
}

export interface RankingReport {
  k: number
  overall: RankingMetrics
  byGroup: Record<string, RankingMetrics>
  /** 취급 없음(unanswerable) 질의 중 결과가 나온 것 — 있으면 잡음 후보 */
  unanswerableWithHits: string[]
}

const SCORED_TYPES: readonly EvalQueryType[] = ['category', 'direct', 'model', 'relevant']

function isRelevant(doc: EvalDoc | undefined, q: EvalQuery): boolean {
  if (!doc) return false
  if (q.type === 'model') return !!q.nameRe && q.nameRe.test(doc.name.trim())
  if (q.relevantRe && q.relevantRe.test(doc.name)) return true
  if (q.expectCats && q.expectCats.includes(doc.category)) return true
  return false
}

/** 질의별 점수(recall·rr·ndcg) — 정답이 하나도 없는 질의는 채점에서 제외(null) */
function scoreQuery(docs: readonly EvalDoc[], search: EvalSearch, q: EvalQuery, k: number): { recall: number; rr: number; ndcg: number; zero: boolean } | null {
  const relevantTotal = docs.filter((d) => isRelevant(d, q)).length
  if (relevantTotal === 0) return null
  const byId = new Map(docs.map((d) => [d.id, d]))
  const hits = search(q.q).slice(0, k)
  const gains = hits.map((h) => (isRelevant(byId.get(h.id), q) ? 1 : 0))
  const found = gains.reduce<number>((a, g) => a + g, 0)
  const firstIdx = gains.indexOf(1)
  const dcg = gains.reduce<number>((a, g, i) => a + g / Math.log2(i + 2), 0)
  const ideal = Array.from({ length: Math.min(k, relevantTotal) }, (_, i) => 1 / Math.log2(i + 2)).reduce((a, b) => a + b, 0)
  return {
    recall: found / Math.min(k, relevantTotal),
    rr: firstIdx >= 0 ? 1 / (firstIdx + 1) : 0,
    ndcg: ideal > 0 ? dcg / ideal : 0,
    zero: hits.length === 0,
  }
}

function aggregate(rows: { recall: number; rr: number; ndcg: number; zero: boolean }[]): RankingMetrics {
  const n = rows.length
  const avg = (f: (r: (typeof rows)[number]) => number): number => (n === 0 ? 0 : rows.reduce((a, r) => a + f(r), 0) / n)
  return { n, recallAtK: avg((r) => r.recall), mrr: avg((r) => r.rr), ndcgAtK: avg((r) => r.ndcg), zeroRate: avg((r) => (r.zero ? 1 : 0)) }
}

export function evaluateRanking(
  docs: readonly EvalDoc[],
  search: EvalSearch,
  queries: readonly EvalQuery[] = DEFAULT_EVAL_QUERIES,
  k = 12,
): RankingReport {
  const groups = new Map<string, { recall: number; rr: number; ndcg: number; zero: boolean }[]>()
  const all: { recall: number; rr: number; ndcg: number; zero: boolean }[] = []
  for (const q of queries) {
    if (!SCORED_TYPES.includes(q.type)) continue
    const s = scoreQuery(docs, search, q, k)
    if (!s) continue
    all.push(s)
    const g = q.group ?? '기타'
    groups.set(g, [...(groups.get(g) ?? []), s])
  }
  const byGroup: Record<string, RankingMetrics> = {}
  for (const [g, rows] of groups) byGroup[g] = aggregate(rows)
  const unanswerableWithHits = queries.filter((q) => q.type === 'unanswerable' && search(q.q).length > 0).map((q) => q.q)
  return { k, overall: aggregate(all), byGroup, unanswerableWithHits }
}

export function formatRanking(r: RankingReport): string {
  const row = (name: string, m: RankingMetrics): string =>
    `  ${name.padEnd(10)} n=${String(m.n).padStart(3)}  recall@${r.k} ${m.recallAtK.toFixed(3)}  MRR ${m.mrr.toFixed(3)}  nDCG@${r.k} ${m.ndcgAtK.toFixed(3)}  0건 ${(m.zeroRate * 100).toFixed(1)}%`
  return [
    row('전체', r.overall),
    ...Object.entries(r.byGroup).map(([g, m]) => row(g, m)),
    r.unanswerableWithHits.length ? `  취급 없음인데 결과가 나온 질의: ${r.unanswerableWithHits.join(', ')}` : '  취급 없음 질의: 전부 0건(정상)',
  ].join('\n')
}
