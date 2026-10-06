import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findLeaks, generateSynthetic } from '../../../scripts/canned-match/synthetic'
import type { Corpus } from '../../../scripts/canned-match/synthetic'

/**
 * 합성 학습 질문 생성기 — 재현성·정답 확정·평가셋 누수 방지
 */
const corpus = JSON.parse(readFileSync(join(process.cwd(), 'src/__tests__/fixtures/cannedCorpus.json'), 'utf-8')) as Corpus

describe('generateSynthetic', () => {
  const a = generateSynthetic(corpus, { seed: 1 })

  it('같은 시드면 같은 결과(재현 가능), 다른 시드면 다른 결과', () => {
    expect(generateSynthetic(corpus, { seed: 1 })).toEqual(a)
    expect(generateSynthetic(corpus, { seed: 2 })).not.toEqual(a)
  })
  it('양성·음성이 모두 충분히 생성된다', () => {
    const pos = a.filter((q) => q.acceptable.length > 0)
    const neg = a.filter((q) => q.acceptable.length === 0)
    expect(pos.length).toBeGreaterThan(500)
    expect(neg.length).toBeGreaterThan(150)
  })
  it('빈 질문이 없고 모든 정답 id가 코퍼스에 존재한다', () => {
    const ids = new Set(corpus.canned.map((c) => c.id))
    for (const q of a) {
      expect(q.query.trim().length).toBeGreaterThan(0)
      for (const id of q.acceptable) expect(ids.has(id)).toBe(true)
    }
  })
  it('음성 종류는 정답이 비어 있고, 양성 종류는 정답이 있다', () => {
    for (const q of a) {
      if (q.kind.startsWith('neg')) expect(q.acceptable).toEqual([])
      else expect(q.acceptable.length).toBeGreaterThan(0)
    }
  })
  it('음성에는 가중치 0.5(라벨이 애매한 틀)와 일반 음성이 함께 있다', () => {
    expect(a.some((q) => q.kind === 'negOffTopic' && q.weight === 0.5)).toBe(true)
    expect(a.some((q) => q.kind === 'negChitchat' && q.weight === undefined)).toBe(true)
  })
  it('같은 빠른답변에서 파생된 양성은 같은 group(교차검증 누수 방지 단위)', () => {
    const byGroup = new Map<string, number>()
    for (const q of a.filter((x) => x.acceptable.length > 0)) byGroup.set(q.group, (byGroup.get(q.group) ?? 0) + 1)
    expect(byGroup.size).toBeLessThanOrEqual(corpus.canned.length)
    expect([...byGroup.keys()].every((g) => corpus.canned.some((c) => c.id === g))).toBe(true)
  })
  it('의미가 같은 형제 답변(예: 양도 안내 2건)은 제목 질문에서 함께 정답으로 인정된다', () => {
    const titleQ = a.find((q) => q.kind === 'title' && q.group === '097ad1d5')
    expect(titleQ?.acceptable).toContain('097ad1d5')
    expect(titleQ?.acceptable).toContain('82564ea6')
  })
})

describe('findLeaks — 평가 전용 질문이 학습에 섞이지 않는지 검사', () => {
  const syn = generateSynthetic(corpus, { seed: 3 })
  it('공백·대소문자를 무시하고 겹치는 합성 질문을 찾아낸다', () => {
    const target = syn[0].query
    const leaks = findLeaks(syn, [target.toUpperCase().replace(/ /g, '')])
    expect(leaks).toContain(target)
  })
  it('겹치지 않으면 빈 배열', () => {
    expect(findLeaks(syn, ['전혀 다른 문장 입니다 1234'])).toEqual([])
  })
})
