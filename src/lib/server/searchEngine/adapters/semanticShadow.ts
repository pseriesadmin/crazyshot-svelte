/**
 * adapters/semanticShadow.ts — 의미 점수 그림자(관찰) 기록 (서버 전용)
 *
 * 검색 응답은 바꾸지 않는다. 설정 semantic.shadow 가 켜져 있고 의미 모델이 있을 때만, 현재 응답 상위 12개와
 * "의미 결합을 켰다면" 상위 12개를 비교한 숫자를 nlsearch_shadow_observations 에 남긴다(원문·상품명 없음).
 * 어떤 실패도 검색 응답에 영향을 주지 않는다(전부 삼킨다). 기본 꺼짐.
 */

import { createClient } from '@supabase/supabase-js'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import type { SemanticModel } from '../core/semanticVectors'
import { getProductSearchIndex, type ProductSearchProvider } from './productSearchIndex'
import { getNlsearchParamsCached } from './nlsearchParams'
import { getSemanticModel } from './semanticModelCache'
import { buildDocVectors, computeShadowObservation, semanticDocText, semanticSimilarities } from './semanticRank'

/** 실제 weight가 0(꺼짐)이어도 "켰다면"을 가늠하기 위한 관찰용 가중 */
export const SHADOW_DEFAULT_WEIGHT = 0.3
const MIN_QUERY_CHARS = 2
/** 관찰 기록 표본 비율 — 켜진 뒤에도 요청의 일부만 추가 계산한다(응답 시간 영향 제한) */
export const SHADOW_SAMPLE_RATE = 0.2
/** 관찰 처리가 검색 응답을 붙잡아 둘 수 있는 최대 시간(ms) — 초과해도 기록은 백그라운드에서 계속될 수 있다 */
export const SHADOW_MAX_WAIT_MS = 500

/** promise가 ms 안에 끝나지 않으면 fallback으로 먼저 돌려준다(원래 작업은 계속 진행, 예외는 삼킴) */
export async function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work.catch(() => fallback), new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), ms) })])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

let docVecCache: { provider: ProductSearchProvider; model: SemanticModel; vecs: Map<string, Float32Array> } | null = null

export function docVectorsFor(provider: ProductSearchProvider, model: SemanticModel): Map<string, Float32Array> {
  if (docVecCache && docVecCache.provider === provider && docVecCache.model === model) return docVecCache.vecs
  const vecs = buildDocVectors(model, provider.docs.map((d) => ({ id: d.id, text: semanticDocText(d) })))
  docVecCache = { provider, model, vecs }
  return vecs
}

export async function recordSemanticShadow(args: { query: string; searchLogId: string | null; currentIds: readonly string[]; sampleRate?: number }): Promise<void> {
  try {
    if (args.query.length < MIN_QUERY_CHARS) return
    const params = await getNlsearchParamsCached()
    if (!params.semantic.shadow) return
    if (Math.random() >= (args.sampleRate ?? SHADOW_SAMPLE_RATE)) return
    const model = await getSemanticModel()
    if (!model) return

    const t0 = Date.now()
    const index = await getProductSearchIndex()
    const sims = semanticSimilarities(model, args.query, docVectorsFor(index, model))
    const lexical = index
      .search(args.query, { fuzzy: params.product.fuzzy, prefix: params.product.prefix, limit: 300 })
      .map((r) => ({ id: r.document.id, score: r.score }))
    const weight = params.semantic.weight > 0 ? params.semantic.weight : SHADOW_DEFAULT_WEIGHT
    const o = computeShadowObservation({ currentIds: args.currentIds, lexical, sims, weight, k: 12 })

    await createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).from('nlsearch_shadow_observations').insert({
      search_log_id: args.searchLogId,
      query_chars: Math.min(args.query.length, 32000),
      result_count_current: o.resultCountCurrent,
      result_count_blend: o.resultCountBlend,
      overlap_k: o.overlapK,
      new_entrants: o.newEntrants,
      dropped: o.dropped,
      top1_same: o.top1Same,
      would_fill_zero: o.wouldFillZero,
      weight: o.weight,
      model_vocab: model.vocab.length,
      latency_ms: Date.now() - t0,
    })
  } catch {
    // 관찰 기록 실패는 검색에 영향을 주지 않는다
  }
}

/** C-2: 크레이지챗 추천 검색의 관찰 기록(숫자만) — 현재 후보 수와 "의미 보조가 새로 더했을 후보 수". 실패는 삼킨다. */
export async function recordRecommendShadow(args: { queryChars: number; currentCount: number; wouldAdd: number; vocab: number }): Promise<void> {
  try {
    await createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).from('nlsearch_shadow_observations').insert({
      source: 'crazychat_recommend',
      search_log_id: null,
      query_chars: Math.min(args.queryChars, 32000),
      result_count_current: Math.min(args.currentCount, 32000),
      result_count_blend: Math.min(args.currentCount + args.wouldAdd, 32000),
      overlap_k: Math.min(args.currentCount, 32000),
      new_entrants: args.wouldAdd,
      dropped: 0,
      top1_same: true,
      would_fill_zero: args.currentCount === 0 && args.wouldAdd > 0,
      weight: 0,
      model_vocab: args.vocab,
      latency_ms: 0,
    })
  } catch {
    // 관찰 기록 실패는 추천에 영향을 주지 않는다
  }
}

export interface SemanticFallbackCandidate {
  product_id: string
  id: string
  name: string
  brand: string
  category: string
  slug: string
}

/**
 * B-5: 약한 매칭 폴백에서만 쓰는 의미 후보(설정 semantic.weight > 0 일 때만). 기존 결과의 순서·내용은 바꾸지 않고,
 * 이미 나온 상품(excludeIds)을 뺀 "새 후보"를 유사도 높은 순으로 최대 max개 돌려준다. 꺼짐·모델 없음·실패는 빈 배열(= 기존과 동일).
 */
export async function semanticFallbackCandidates(args: { query: string; excludeIds: ReadonlySet<string>; max?: number }): Promise<SemanticFallbackCandidate[]> {
  try {
    if (args.query.length < MIN_QUERY_CHARS) return []
    const params = await getNlsearchParamsCached()
    if (!(params.semantic.weight > 0)) return []
    const model = await getSemanticModel()
    if (!model) return []
    const index = await getProductSearchIndex()
    const sims = semanticSimilarities(model, args.query, docVectorsFor(index, model))
    const byId = new Map(index.docs.map((d) => [d.id, d]))
    return [...sims.entries()]
      .filter(([id]) => !args.excludeIds.has(id) && byId.has(id))
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, args.max ?? 3)
      .map(([id]) => {
        const d = byId.get(id)!
        return { product_id: id, id, name: d.name, brand: d.brand, category: d.category, slug: d.slug }
      })
  } catch {
    return []
  }
}
