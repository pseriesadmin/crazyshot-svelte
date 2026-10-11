/**
 * adapters/semanticRank.ts — 글자 일치 점수 + 의미 유사도 결합 (순수 모듈, DB·$env 없음)
 *
 * 결합식: combined = lexical/maxLexical + weight × similarity  (유사도가 MIN_SEMANTIC_SIMILARITY 이상일 때만 더함)
 *  · weight 0 이면 입력을 그대로 돌려준다(꺼짐 = 기존 결과와 동일).
 *  · 글자 일치 1위가 2위의 DOMINANT_RATIO배 이상이면(정확 일치급) 의미 점수로 강등되지 않는다(EC-3).
 *  · 글자 일치에 없던 상품도 유사도가 기준 이상이면 후보로 들어온다(0건 질의 구제).
 * 분류 의도 재정렬(createCategoryIntentSearch)은 점수를 압축하므로, 호출 측은 반드시 "재정렬 이전의 원점수"를 넘긴다.
 */

import { cosine, embedText, type SemanticModel } from '../core/semanticVectors'
import type { ProductDoc } from './productSearchDocs'

export interface ScoredId {
  id: string
  score: number
}

export const MIN_SEMANTIC_SIMILARITY = 0.3
export const DOMINANT_RATIO = 2

export function blendScores(lexical: readonly ScoredId[], sims: ReadonlyMap<string, number>, weight: number): ScoredId[] {
  if (!(weight > 0)) return lexical.map((x) => ({ ...x }))
  const max = lexical.reduce((m, x) => Math.max(m, x.score), 0)
  const norm = (s: number): number => (max > 0 ? s / max : 0)
  const byId = new Map<string, number>()
  for (const x of lexical) byId.set(x.id, norm(x.score))
  const out = new Map<string, number>()
  for (const [id, lexNorm] of byId) {
    const sim = sims.get(id) ?? 0
    out.set(id, lexNorm + (sim >= MIN_SEMANTIC_SIMILARITY ? weight * sim : 0))
  }
  for (const [id, sim] of sims) {
    if (!byId.has(id) && sim >= MIN_SEMANTIC_SIMILARITY) out.set(id, weight * sim)
  }
  const ranked = [...out.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))

  // 지배적 1위 보호: 글자 일치 1위가 2위의 DOMINANT_RATIO배 이상이면 결합 후에도 맨 앞에 둔다
  const top = lexical[0]
  const second = lexical[1]
  if (top && (!second || top.score >= second.score * DOMINANT_RATIO) && ranked[0]?.id !== top.id) {
    const idx = ranked.findIndex((x) => x.id === top.id)
    if (idx > 0) {
      const [item] = ranked.splice(idx, 1)
      ranked.unshift(item)
    }
  }
  return ranked
}

/** 문서 텍스트들을 미리 임베딩해 둔 맵(모델·문서가 같으면 재사용) */
export function buildDocVectors(model: SemanticModel, docs: readonly { id: string; text: string }[]): Map<string, Float32Array> {
  const map = new Map<string, Float32Array>()
  for (const d of docs) map.set(d.id, embedText(model, d.text))
  return map
}

/** 질의와 모든 문서의 코사인 유사도 중 기준 이상만(영벡터 질의면 빈 맵 = 의미 점수 없음) */
export function semanticSimilarities(model: SemanticModel, query: string, docVecs: ReadonlyMap<string, Float32Array>): Map<string, number> {
  const q = embedText(model, query)
  const out = new Map<string, number>()
  if (q.every((x) => x === 0)) return out
  for (const [id, v] of docVecs) {
    const s = cosine(q, v)
    if (s >= MIN_SEMANTIC_SIMILARITY) out.set(id, s)
  }
  return out
}

export interface ShadowObservation {
  resultCountCurrent: number
  resultCountBlend: number
  overlapK: number
  newEntrants: number
  dropped: number
  top1Same: boolean
  wouldFillZero: boolean
  weight: number
}

/** 현재 응답 상위 K와 의미 결합 상위 K를 비교한 숫자 관찰값(원문·상품명 없음) */
export function computeShadowObservation(input: {
  currentIds: readonly string[]
  lexical: readonly ScoredId[]
  sims: ReadonlyMap<string, number>
  weight: number
  k?: number
}): ShadowObservation {
  const k = input.k ?? 12
  const current = input.currentIds.slice(0, k)
  const blend = blendScores(input.lexical, input.sims, input.weight).slice(0, k).map((x) => x.id)
  const curSet = new Set(current)
  const overlap = blend.filter((id) => curSet.has(id)).length
  return {
    resultCountCurrent: current.length,
    resultCountBlend: blend.length,
    overlapK: overlap,
    newEntrants: blend.length - overlap,
    dropped: current.length - overlap,
    top1Same: current.length > 0 && blend.length > 0 ? current[0] === blend[0] : current.length === 0 && blend.length === 0,
    wouldFillZero: current.length === 0 && blend.length > 0,
    weight: input.weight,
  }
}

/** 상품 문서를 의미 임베딩용 텍스트로 (후기·본문은 제외 — 상품 정체성을 나타내는 칸만) */
export function semanticDocText(d: ProductDoc): string {
  return [d.name, d.brand, d.caption, d.keywords_text, d.category_label, d.components_text, d.specs_text].filter(Boolean).join(' ')
}
