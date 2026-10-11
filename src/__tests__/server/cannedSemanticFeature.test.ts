/**
 * cannedSemanticFeature.test.ts — C-1 의미 유사도 관찰 특징: 판정 불변 + 숫자만 덧붙임
 */
import { describe, it, expect } from 'vitest'
import { semanticCannedFeatures } from '$lib/server/cannedSemanticFeature'
import { buildObservationRow, decideAutoReply } from '$lib/server/cannedAutoReply'
import { buildSemanticModel } from '$lib/server/searchEngine/core/semanticVectors'

const model = buildSemanticModel(
  [
    { text: '반납 연장 방법 안내 문의' }, { text: '반납 연장 가능 여부 문의' },
    { text: '결제 취소 환불 규정 안내' }, { text: '결제 환불 취소 방법 문의' },
  ],
  { dim: 32, minCount: 1 },
)
const canned = { title: '반납 연장 안내', content: '반납 연장은 가능합니다', match_keywords: ['반납연장'] }

describe('semanticCannedFeatures', () => {
  it('모델·질문·후보 중 하나라도 비면 null', () => {
    expect(semanticCannedFeatures(null, '반납 연장', canned)).toBeNull()
    expect(semanticCannedFeatures(model, '  ', canned)).toBeNull()
    expect(semanticCannedFeatures(model, '반납 연장', null)).toBeNull()
  })

  it('관련 후보가 무관한 후보보다 높고 값은 0~1 숫자', () => {
    const related = semanticCannedFeatures(model, '반납 연장 가능한가요', canned)!
    const other = semanticCannedFeatures(model, '결제 취소 환불', canned)!
    expect(related.semantic_cosine).toBeGreaterThan(other.semantic_cosine)
    for (const v of [related.semantic_cosine, related.semantic_cosine_full]) expect(v >= 0 && v <= 1).toBe(true)
  })
})

describe('buildObservationRow — 의미 특징은 덧붙일 뿐 판정은 불변', () => {
  const cands = [{ id: 'c1', title: '반납 연장 안내', content: '반납 연장은 가능합니다', category: null, shortcut: null, match_keywords: ['반납연장'], usage_count: 0 }]
  const d = decideAutoReply('반납 연장 가능한가요?', cands, [])

  it('semanticExtra가 없으면 기존 행과 동일', () => {
    const a = buildObservationRow('m1', 'observe', d)
    const b = buildObservationRow('m1', 'observe', d, undefined, null)
    expect(b).toEqual(a)
  })

  it('있으면 features에만 두 숫자가 추가되고 나머지 필드(판정·확률)는 같다', () => {
    const base = buildObservationRow('m1', 'observe', d)
    const withSem = buildObservationRow('m1', 'observe', d, undefined, { semantic_cosine: 0.5, semantic_cosine_full: 0.4 })
    expect({ ...withSem, features: null }).toEqual({ ...base, features: null })
    if (base.features) {
      expect(withSem.features).toMatchObject({ ...base.features, semantic_cosine: 0.5, semantic_cosine_full: 0.4 })
    }
  })
})
