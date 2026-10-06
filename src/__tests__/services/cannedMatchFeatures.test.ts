import { describe, it, expect } from 'vitest'
import { evaluateCannedMatch } from '$lib/server/matchCannedResponse'
import type { CannedResponseForMatch } from '$lib/server/matchCannedResponse'

/**
 * 확률 모델 입력(특징값) 공개 계약 — 판정 규칙이 계산하는 값이 top[]에 일관되게 실린다
 */
const mk = (id: string, title: string, kws: string[], extra: Partial<CannedResponseForMatch> = {}): CannedResponseForMatch => ({
  id, title, content: `${title} 본문`, category: null, shortcut: null, match_keywords: kws, usage_count: 0, ...extra,
})
const cands = [
  mk('dep', '보증금은 얼마인가요?', ['보증금', '보증'], { shortcut: '보증금' }),
  mk('ret', '반납 안내 기본', ['반납', '반납방법'], { shortcut: '반납' }),
  mk('ext', '연장 요청 안내', ['연장', '기간연장']),
]

describe('evaluateCannedMatch — features 공개', () => {
  it('top[]은 최대 3개이고 모든 항목에 features와 passesRules가 있다', () => {
    const r = evaluateCannedMatch('보증금 얼마예요?', cands)
    expect(r.top.length).toBeGreaterThan(0)
    expect(r.top.length).toBeLessThanOrEqual(3)
    for (const t of r.top) {
      expect(typeof t.passesRules).toBe('boolean')
      expect(Object.keys(t.features).sort()).toEqual(
        ['concepts', 'contentBonus', 'coverage', 'curatedConcepts', 'curatedHit', 'evidence', 'gapToBest', 'maxTermLen', 'nonGenericRatio',
          'shortcutHit', 'titleOnly', 'tokenCount', 'unexplainedContentTokens', 'unexplainedVerbalRatio'].sort(),
      )
    }
  })
  it('답변 판정이면 선택된 후보가 규칙을 통과했고 1등 gapToBest는 0 이상', () => {
    const r = evaluateCannedMatch('보증금 얼마예요?', cands)
    expect(r.decision).toBe('answer')
    expect(r.top[0].id).toBe(r.best?.id)
    expect(r.top[0].passesRules).toBe(true)
    expect(r.top[0].features.gapToBest).toBeGreaterThanOrEqual(0)
    expect(r.top[0].features.shortcutHit).toBe(1)
    expect(r.top[0].features.curatedHit).toBe(1)
    expect(r.top[0].features.titleOnly).toBe(0)
  })
  it('값의 범위·일관성: 커버리지 0~1, curatedHit와 titleOnly는 서로 반대', () => {
    for (const q of ['반납 어떻게 하나요', '연장하고 싶어요', '보증금', '오늘 날씨 어때요']) {
      for (const t of evaluateCannedMatch(q, cands).top) {
        expect(t.features.coverage).toBeGreaterThanOrEqual(0)
        expect(t.features.coverage).toBeLessThanOrEqual(1)
        expect(t.features.curatedHit + t.features.titleOnly).toBe(1)
        expect(t.features.tokenCount).toBeGreaterThan(0)
        expect(t.features.nonGenericRatio).toBeGreaterThanOrEqual(0)
        expect(t.features.nonGenericRatio).toBeLessThanOrEqual(1)
      }
    }
  })
  it('1등이 아닌 후보의 gapToBest는 음수(1등과의 격차)', () => {
    const r = evaluateCannedMatch('반납 어떻게 하나요', cands)
    expect(r.top[0].features.gapToBest).toBeGreaterThan(0)
    for (const t of r.top.slice(1)) expect(t.features.gapToBest).toBeLessThanOrEqual(0)
  })
  it('설명하지 못하는 내용어가 있으면 unexplainedContentTokens가 늘고 coverage는 낮아진다', () => {
    const clean = evaluateCannedMatch('보증금', cands).top[0].features
    const noisy = evaluateCannedMatch('보증금 색상 무게', cands).top[0].features
    expect(noisy.unexplainedContentTokens).toBeGreaterThan(clean.unexplainedContentTokens)
    expect(noisy.coverage).toBeLessThan(clean.coverage)
  })
  it('판정 규칙(기준값·결과)은 features 공개로 바뀌지 않는다', () => {
    expect(evaluateCannedMatch('답변이 계속 엉뚱하게만 오네요', cands).decision).toBe('no_match')
    expect(evaluateCannedMatch('반납은 어떻게 하나요', cands).best?.id).toBe('ret')
  })
})
