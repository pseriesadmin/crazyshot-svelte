// recommend-semantic.ts — 크레이지챗 추천 검색의 의미 후보 보조 (C-2)
//
// 원칙: ① 기본 꺼짐(설정 semantic.recommend=false) — 켜져도 "새 후보만" 낮은 점수로 더한다(기존 후보의 점수·순위는 절대 바꾸지 않는다)
//       ② 관찰(semantic.shadow)만 켜면 결과는 그대로이고 "추가됐을 후보 수"만 숫자로 기록한다 ③ 어떤 실패도 추천 결과에 영향 없음(null)
// 환경변수($env)를 쓰는 모듈은 실제 호출 시점에만 불러온다(단위 테스트가 환경 없이 import 가능하도록).
import { MIN_SEMANTIC_SIMILARITY } from '$lib/server/searchEngine/adapters/semanticRank'

export const SEM_ADD_FACTOR = 0.35
export const SEM_MAX_ADD = 3

export interface SemanticAssist {
  recommend: boolean
  shadow: boolean
  sims: ReadonlyMap<string, number>
  /** 관찰 기록 콜백(숫자만). 기본 로더가 DB 기록을 연결한다 */
  onShadow?: (o: { currentCount: number; wouldAdd: number }) => void | Promise<void>
}
export type SemanticAssistLoader = (query: string) => Promise<SemanticAssist | null>

/**
 * 병합 맵에 없는 의미 후보를 유사도 높은 순으로 최대 SEM_MAX_ADD개 고른다. apply=true면 점수 = 현재 최고점 × SEM_ADD_FACTOR × 유사도로 추가.
 * 돌려주는 값은 (추가했거나 추가됐을) 후보 id.
 */
export function applySemanticCandidates(merged: Map<string, number>, sims: ReadonlyMap<string, number>, apply: boolean): string[] {
  const maxLex = [...merged.values()].reduce((m, v) => Math.max(m, v), 0) || 1
  const picks = [...sims.entries()]
    .filter(([id, s]) => !merged.has(id) && s >= MIN_SEMANTIC_SIMILARITY)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, SEM_MAX_ADD)
  if (apply) for (const [id, s] of picks) merged.set(id, maxLex * SEM_ADD_FACTOR * s)
  return picks.map(([id]) => id)
}

/** 기본 로더 — 설정이 둘 다 꺼져 있거나 모델이 없으면 null(= 기존 동작) */
export const defaultSemanticAssistLoader: SemanticAssistLoader = async (query) => {
  try {
    const { getNlsearchParamsCached } = await import('$lib/server/searchEngine/adapters/nlsearchParams')
    const params = await getNlsearchParamsCached()
    if (!params.semantic.recommend && !params.semantic.shadow) return null
    const { getSemanticModel } = await import('$lib/server/searchEngine/adapters/semanticModelCache')
    const model = await getSemanticModel()
    if (!model) return null
    const { getProductSearchIndex } = await import('$lib/server/searchEngine/adapters/productSearchIndex')
    const { docVectorsFor, recordRecommendShadow } = await import('$lib/server/searchEngine/adapters/semanticShadow')
    const { semanticSimilarities } = await import('$lib/server/searchEngine/adapters/semanticRank')
    const index = await getProductSearchIndex()
    const sims = semanticSimilarities(model, query, docVectorsFor(index, model))
    return {
      recommend: params.semantic.recommend,
      shadow: params.semantic.shadow,
      sims,
      onShadow: (o) => recordRecommendShadow({ queryChars: query.length, currentCount: o.currentCount, wouldAdd: o.wouldAdd, vocab: model.vocab.length }),
    }
  } catch {
    return null
  }
}
