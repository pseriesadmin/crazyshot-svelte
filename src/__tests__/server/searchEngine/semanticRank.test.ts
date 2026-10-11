/**
 * semanticRank.test.ts — B-4 의미 점수 결합·그림자 계산 순수 계약
 * ① weight 0 = 글자 일치 순서 그대로 ② 의미 점수는 보조(정규화 후 가중 합) ③ 지배적 1위(정확 일치)는 강등 금지(EC-3)
 * ④ 어휘 밖·약한 유사도는 잡음을 만들지 않음 ⑤ 그림자 관찰값은 숫자만
 */
import { describe, it, expect } from 'vitest'
import { blendScores, computeShadowObservation, MIN_SEMANTIC_SIMILARITY } from '$lib/server/searchEngine/adapters/semanticRank'

const lex = [
  { id: 'a', score: 10 },
  { id: 'b', score: 8 },
  { id: 'c', score: 6 },
]

describe('blendScores', () => {
  it('weight 0이면 글자 일치 순서·점수가 그대로다', () => {
    const r = blendScores(lex, new Map([['c', 0.99]]), 0)
    expect(r.map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(r.map((x) => x.score)).toEqual([10, 8, 6])
  })

  it('의미 유사도가 높은 상품이 가중 합으로 올라온다(지배적 1위가 아닐 때)', () => {
    const r = blendScores(lex, new Map([['c', 0.9]]), 1)
    expect(r[0].id).toBe('c') // 6/10 + 0.9 = 1.5 > a 1.0
  })

  it('글자 일치에 없던 상품도 유사도가 기준 이상이면 들어온다, 미만이면 안 들어온다', () => {
    const r = blendScores(lex, new Map([['x', MIN_SEMANTIC_SIMILARITY + 0.2], ['y', MIN_SEMANTIC_SIMILARITY - 0.05]]), 0.5)
    expect(r.map((x) => x.id)).toContain('x')
    expect(r.map((x) => x.id)).not.toContain('y')
  })

  it('지배적 1위(2위의 2배 이상)는 의미 점수로 강등되지 않는다', () => {
    const dominant = [{ id: 'exact', score: 100 }, { id: 'o1', score: 20 }]
    const r = blendScores(dominant, new Map([['o1', 0.99]]), 1)
    expect(r[0].id).toBe('exact')
  })

  it('지배 경계: 정확히 2배면 보호, 2배 미만이면 의미 점수로 뒤집힐 수 있고, 2위가 없으면 보호', () => {
    const exactly = blendScores([{ id: 'a', score: 20 }, { id: 'b', score: 10 }], new Map([['b', 0.95]]), 1)
    expect(exactly[0].id).toBe('a')
    const below = blendScores([{ id: 'a', score: 19 }, { id: 'b', score: 10 }], new Map([['b', 0.95]]), 1)
    expect(below[0].id).toBe('b')
    const single = blendScores([{ id: 'a', score: 5 }], new Map([['x', 0.99]]), 1)
    expect(single[0].id).toBe('a')
  })

  it('유사도 기준값 경계: 기준과 같으면 포함, 바로 아래면 제외', () => {
    const at = blendScores(lex, new Map([['n', MIN_SEMANTIC_SIMILARITY]]), 1)
    expect(at.map((x) => x.id)).toContain('n')
    const under = blendScores(lex, new Map([['n', MIN_SEMANTIC_SIMILARITY - 0.001]]), 1)
    expect(under.map((x) => x.id)).not.toContain('n')
  })

  it('유사도 맵이 비어 있으면 순서 불변', () => {
    expect(blendScores(lex, new Map(), 0.5).map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })

  it('입력 배열을 변경하지 않는다', () => {
    const copy = JSON.parse(JSON.stringify(lex))
    blendScores(lex, new Map([['c', 0.9]]), 1)
    expect(lex).toEqual(copy)
  })
})

describe('computeShadowObservation', () => {
  const lexical = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, score: 20 - i }))

  it('현재 상위 K와 결합 상위 K의 겹침·진입·이탈·1위 일치를 숫자로 낸다', () => {
    const current = lexical.slice(0, 12).map((x) => x.id)
    const sims = new Map([['p15', 0.95], ['p16', 0.9]])
    const o = computeShadowObservation({ currentIds: current, lexical, sims, weight: 1, k: 12 })
    expect(o.resultCountCurrent).toBe(12)
    expect(o.overlapK).toBeLessThan(12)
    expect(o.newEntrants).toBeGreaterThan(0)
    expect(o.newEntrants).toBe(o.dropped)
    expect(typeof o.top1Same).toBe('boolean')
    expect(Object.values(o).every((v) => typeof v === 'number' || typeof v === 'boolean')).toBe(true)
  })

  it('현재 결과가 0건인데 결합으로 채워지면 wouldFillZero', () => {
    const o = computeShadowObservation({ currentIds: [], lexical: [], sims: new Map([['p1', 0.8]]), weight: 0.5, k: 12 })
    expect(o.wouldFillZero).toBe(true)
    expect(o.resultCountBlend).toBe(1)
  })

  it('의미 유사도가 전혀 없으면 현재와 동일(겹침 = 현재 건수, 진입 0)', () => {
    const current = lexical.slice(0, 5).map((x) => x.id)
    const o = computeShadowObservation({ currentIds: current, lexical: lexical.slice(0, 5), sims: new Map(), weight: 0.5, k: 12 })
    expect(o.overlapK).toBe(5)
    expect(o.newEntrants).toBe(0)
    expect(o.top1Same).toBe(true)
  })
})
