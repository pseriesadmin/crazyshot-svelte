// cannedSemanticFeature.ts — 빠른답변 매칭의 "의미 유사도" 관찰 특징 (순수 함수, DB·$env 없음)
//
// C-1(2026-10-10): 판정에는 쓰지 않는다. 관찰 기록(canned_match_observations.features)에 숫자 2개만 덧붙여, 나중에 확률 모델에
// 이 특징을 넣을 이득이 있는지 오프라인으로 비교할 수 있게 한다. 모델이 없거나 질문·후보가 비면 null(기록 생략).
//  · semantic_cosine    : 질문 ↔ 후보의 제목+키워드(이 답변이 무엇에 대한 것인지)
//  · semantic_cosine_full: 질문 ↔ 후보의 제목+키워드+본문 전체
import { cosine, embedText, type SemanticModel } from './searchEngine/core/semanticVectors'

export interface SemanticCannedFeatures {
  semantic_cosine: number
  semantic_cosine_full: number
}

export interface CannedTextSource {
  title: string
  content: string
  match_keywords: string[]
}

const round4 = (n: number): number => Math.round(n * 10000) / 10000

export function semanticCannedFeatures(model: SemanticModel | null, message: string, canned: CannedTextSource | null): SemanticCannedFeatures | null {
  if (!model || !canned || !message.trim()) return null
  const q = embedText(model, message)
  const head = [canned.title, canned.match_keywords.join(' ')].filter(Boolean).join(' ')
  const full = [head, canned.content].filter(Boolean).join(' ')
  return {
    semantic_cosine: round4(Math.max(0, cosine(q, embedText(model, head)))),
    semantic_cosine_full: round4(Math.max(0, cosine(q, embedText(model, full)))),
  }
}
