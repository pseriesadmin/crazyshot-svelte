/**
 * searchEvalFixture.test.ts — 평가 질의 세트 외부화(A-1) 계약 테스트
 * 질의는 fixtures/nlsearchEvalQueries.json 에서 오고, 평가의 total은 세트 길이를 따른다.
 */
import { describe, it, expect } from 'vitest'
import {
  CATEGORY_QUERIES,
  DIRECT_QUERIES,
  FREE_QUERIES,
  MODEL_QUERIES,
  DEFAULT_EVAL_QUERIES,
  evaluate,
  evaluateRanking,
  parseEvalQueries,
  type EvalDoc,
} from '../../helpers/searchEval'
import raw from '../../fixtures/nlsearchEvalQueries.json'

describe('평가 질의 세트 외부화', () => {
  it('기존 32질의가 유형별 개수 그대로 로드된다', () => {
    expect(CATEGORY_QUERIES).toHaveLength(17)
    expect(DIRECT_QUERIES).toHaveLength(9)
    expect(MODEL_QUERIES).toHaveLength(4)
    expect(FREE_QUERIES).toHaveLength(2)
  })

  it('model 질의의 nameRe는 RegExp로 복원된다', () => {
    expect(MODEL_QUERIES[0].nameRe).toBeInstanceOf(RegExp)
    expect(MODEL_QUERIES[0].nameRe.test('Sony A7S3')).toBe(true)
  })

  it('parseEvalQueries: 잘못된 항목(유형 불명·분류 기대 없음)은 오류로 거절', () => {
    expect(() => parseEvalQueries([{ q: 'x', type: 'weird' }])).toThrow()
    expect(() => parseEvalQueries([{ q: 'x', type: 'category' }])).toThrow()
    expect(() => parseEvalQueries([{ q: 'x', type: 'model' }])).toThrow()
    expect(() => parseEvalQueries([{ q: '', type: 'free' }])).toThrow()
  })

  it('evaluate의 total은 넘겨준 세트 길이를 따른다(상수 길이에 묶이지 않음)', () => {
    const docs: EvalDoc[] = [{ id: 'a', name: 'A', category: 'camera' }]
    const queries = parseEvalQueries(raw).filter((x) => x.type === 'category').slice(0, 3)
    const r = evaluate(docs, () => [{ id: 'a', score: 1 }], () => [{ id: 'a', score: 1 }], parseEvalQueries([...queries, ...raw.filter((x) => x.type !== 'category')]))
    expect(r.categoryTop3.total).toBe(3)
  })
})

describe('A-2 확장 세트(150개)와 순위 지표', () => {
  it('질의 150개, 중복 없음, 유형별로 필요한 정답 정의가 있다', () => {
    expect(DEFAULT_EVAL_QUERIES).toHaveLength(150)
    expect(new Set(DEFAULT_EVAL_QUERIES.map((x) => x.q)).size).toBe(150)
    for (const q of DEFAULT_EVAL_QUERIES.filter((x) => x.type === 'relevant')) {
      expect(!!q.relevantRe || (q.expectCats?.length ?? 0) > 0).toBe(true)
    }
    expect(DEFAULT_EVAL_QUERIES.filter((x) => x.type === 'unanswerable').length).toBeGreaterThan(0)
  })

  const docs: EvalDoc[] = [
    { id: '1', name: 'Sony A7S3', category: 'camera' },
    { id: '2', name: 'Canon 5D Mark IV', category: 'camera' },
    { id: '3', name: 'Sony FE 50mm', category: 'lens' },
  ]
  const qs = parseEvalQueries([
    { q: '소니', type: 'relevant', relevantRe: 'Sony', group: 'g1' },
    { q: '카메라', type: 'relevant', expectCats: ['camera'], group: 'g2' },
    { q: '고프로', type: 'unanswerable' },
  ])

  it('완벽한 순위면 recall·MRR·nDCG가 1이고, 뒤집히면 MRR이 내려간다', () => {
    const perfect = evaluateRanking(docs, (q) => (q === '소니' ? [{ id: '1', score: 2 }, { id: '3', score: 1 }] : [{ id: '1', score: 2 }, { id: '2', score: 1 }]), qs)
    expect(perfect.overall.recallAtK).toBe(1)
    expect(perfect.overall.mrr).toBe(1)
    expect(perfect.overall.ndcgAtK).toBeCloseTo(1, 5)
    const worse = evaluateRanking(docs, (q) => (q === '소니' ? [{ id: '2', score: 2 }, { id: '1', score: 1 }] : []), qs)
    expect(worse.byGroup.g1.mrr).toBe(0.5)
    expect(worse.byGroup.g2.zeroRate).toBe(1)
    expect(worse.overall.zeroRate).toBe(0.5)
  })

  it('취급 없음 질의에 결과가 나오면 잡음으로 보고한다(채점에는 불포함)', () => {
    const r = evaluateRanking(docs, () => [{ id: '1', score: 1 }], qs)
    expect(r.unanswerableWithHits).toEqual(['고프로'])
    expect(r.overall.n).toBe(2)
  })
})
