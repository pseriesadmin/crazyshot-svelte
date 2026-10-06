import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  FEATURE_NAMES, brierScore, calibrationBins, chooseThreshold, createPriorModel, decideWithModel, featureVector, metricsAt,
  parseModel, predictProbability, rocAuc, scoreSamples, seededRandom, sgdStep, shuffled, sigmoid, toObservationRecord, trainBatch,
} from '$lib/server/cannedMatchModel'
import type { Sample } from '$lib/server/cannedMatchModel'
import type { CannedMatchEvaluation, CannedMatchFeatures } from '$lib/server/matchCannedResponse'

/**
 * 자동답변 확률 모델 — 순수함수 테스트 (학습·온라인 갱신·임계값·보정·최종 판정)
 */

const base: CannedMatchFeatures = {
  evidence: 2.4, coverage: 0.7, concepts: 2, curatedConcepts: 2, curatedHit: 1, titleOnly: 0, shortcutHit: 0, maxTermLen: 4,
  tokenCount: 3, nonGenericRatio: 1, contentBonus: 0, unexplainedVerbalRatio: 0, unexplainedContentTokens: 0, gapToBest: 2,
}
const feat = (over: Partial<CannedMatchFeatures> = {}): CannedMatchFeatures => ({ ...base, ...over })

/** 커버리지·미설명 단어 수로 정답이 갈리는 분리 가능한 합성 표본 */
function separable(n: number, seed = 1): Sample[] {
  const rnd = seededRandom(seed)
  const out: Sample[] = []
  for (let i = 0; i < n; i++) {
    const good = rnd() > 0.5
    out.push({
      label: good ? 1 : 0,
      features: feat({
        coverage: good ? 0.7 + rnd() * 0.3 : rnd() * 0.45,
        unexplainedContentTokens: good ? 0 : 1 + Math.floor(rnd() * 2),
        gapToBest: good ? 1 + rnd() * 3 : -1 + rnd() * 1.5,
        evidence: good ? 2 + rnd() * 3 : 1.2 + rnd(),
      }),
    })
  }
  return out
}

describe('특징 벡터', () => {
  it('길이가 FEATURE_NAMES와 같고 값이 정규화 범위(약 -1~1)에 있다', () => {
    const v = featureVector(feat({ evidence: 99, concepts: 99, gapToBest: -99, tokenCount: 99, maxTermLen: 99 }))
    expect(v.length).toBe(FEATURE_NAMES.length)
    expect(v.every((x) => x >= -1 && x <= 1)).toBe(true)
  })
  it('sigmoid는 극단값에서도 안정적이다', () => {
    expect(sigmoid(0)).toBeCloseTo(0.5)
    expect(sigmoid(1000)).toBe(1)
    expect(sigmoid(-1000)).toBe(0)
    expect(sigmoid(2) + sigmoid(-2)).toBeCloseTo(1)
  })
})

describe('일괄 학습(trainBatch)', () => {
  it('분리 가능한 데이터를 학습해 정답은 높게, 오답은 낮게 예측한다', () => {
    const train = separable(300, 11)
    const model = trainBatch(train)
    const test = separable(200, 99)
    const scored = scoreSamples(model, test)
    expect(rocAuc(scored)).toBeGreaterThan(0.95)
    const good = scored.filter((s) => s.label === 1).map((s) => s.p)
    const bad = scored.filter((s) => s.label === 0).map((s) => s.p)
    expect(good.reduce((a, b) => a + b, 0) / good.length).toBeGreaterThan(0.75)
    expect(bad.reduce((a, b) => a + b, 0) / bad.length).toBeLessThan(0.3)
  })
  it('결정적이다 — 같은 입력이면 같은 가중치', () => {
    const a = trainBatch(separable(120, 5))
    const b = trainBatch(separable(120, 5))
    expect(a.weights).toEqual(b.weights)
    expect(a.bias).toBe(b.bias)
  })
  it('커버리지가 높을수록 확률이 단조 증가한다(다른 특징 고정)', () => {
    const model = trainBatch(separable(300, 3))
    const ps = [0.3, 0.5, 0.7, 0.9].map((c) => predictProbability(model, feat({ coverage: c })))
    for (let i = 1; i < ps.length; i++) expect(ps[i]).toBeGreaterThan(ps[i - 1])
  })
  it('표본이 없으면 시작 모델을 그대로 돌려준다', () => {
    const prior = createPriorModel()
    expect(trainBatch([]).weights).toEqual(prior.weights)
  })
  it('원본 시작 모델을 변경하지 않는다', () => {
    const prior = createPriorModel()
    const copy = [...prior.weights]
    trainBatch(separable(50), { init: prior })
    expect(prior.weights).toEqual(copy)
  })
})

describe('온라인 갱신(sgdStep) — 관리자 피드백 1건', () => {
  const trained = trainBatch(separable(300, 21))
  const f = feat({ coverage: 0.62, evidence: 2.0, gapToBest: 0.5 })

  it('정답(1) 피드백은 확률을 올리고 오답(0) 피드백은 내린다', () => {
    const p0 = predictProbability(trained, f)
    expect(predictProbability(sgdStep(trained, f, 1), f)).toBeGreaterThan(p0)
    expect(predictProbability(sgdStep(trained, f, 0), f)).toBeLessThan(p0)
  })
  it('원본 모델을 변경하지 않는다(불변)', () => {
    const before = [...trained.weights]
    sgdStep(trained, f, 0)
    expect(trained.weights).toEqual(before)
  })
  it('앵커(L2)가 있으면 모순된 피드백이 반복돼도 사전학습 모델에서 멀리 벗어나지 않는다', () => {
    const drift = (l2: number): number => {
      let m = trained
      for (let i = 0; i < 200; i++) m = sgdStep(m, f, i % 2 === 0 ? 1 : 0, { lr: 0.3, l2, anchor: trained })
      return m.weights.reduce((a, w, j) => a + Math.abs(w - trained.weights[j]), 0)
    }
    // 한쪽 라벨만 계속 오는 극단 상황에서도 앵커가 세면 덜 움직인다
    const oneSided = (l2: number): number => {
      let m = trained
      for (let i = 0; i < 200; i++) m = sgdStep(m, f, 0, { lr: 0.3, l2, anchor: trained })
      return m.weights.reduce((a, w, j) => a + Math.abs(w - trained.weights[j]), 0)
    }
    expect(oneSided(0.5)).toBeLessThan(oneSided(0))
    expect(drift(0.5)).toBeLessThanOrEqual(drift(0) + 1e-9)
  })
  it('피드백이 쌓일수록 해당 유형은 실제로 학습된다', () => {
    let m = trained
    const p0 = predictProbability(m, f)
    for (let i = 0; i < 30; i++) m = sgdStep(m, f, 0, { lr: 0.3, l2: 0.02, anchor: trained })
    expect(predictProbability(m, f)).toBeLessThan(p0 - 0.2)
    expect(m.trainedSamples).toBe(trained.trainedSamples + 30)
  })
})

describe('임계값·평가', () => {
  // 확률이 높을수록 정답일 가능성이 높은 점수 집합
  const scored = [
    ...Array.from({ length: 40 }, (_, i) => ({ p: 0.95 - i * 0.001, label: 1 as const })),
    ...Array.from({ length: 10 }, (_, i) => ({ p: 0.8 - i * 0.01, label: 1 as const })),
    ...Array.from({ length: 10 }, (_, i) => ({ p: 0.78 - i * 0.01, label: 0 as const })),
    ...Array.from({ length: 20 }, (_, i) => ({ p: 0.4 - i * 0.01, label: 0 as const })),
  ]
  it('chooseThreshold는 목표 정밀도를 만족하는 가장 낮은 임계값을 고른다', () => {
    const c = chooseThreshold(scored, 0.97)
    expect(c.achieved).toBe(true)
    expect(metricsAt(scored, c.threshold).precision).toBeGreaterThanOrEqual(0.97)
    // 더 낮은 임계값으로는 목표를 못 지킨다 = "가장 많이 답변하는" 선택
    expect(metricsAt(scored, c.threshold - 0.05).precision).toBeLessThan(0.97)
  })
  it('달성 불가 목표면 achieved=false', () => {
    const impossible = Array.from({ length: 20 }, (_, i) => ({ p: 0.9 - i * 0.01, label: (i % 2) as 0 | 1 }))
    expect(chooseThreshold(impossible, 0.99).achieved).toBe(false)
  })
  it('AUC·Brier·신뢰도 곡선', () => {
    expect(rocAuc([{ p: 0.9, label: 1 }, { p: 0.1, label: 0 }])).toBe(1)
    expect(rocAuc([{ p: 0.1, label: 1 }, { p: 0.9, label: 0 }])).toBe(0)
    expect(brierScore([{ p: 1, label: 1 }, { p: 0, label: 0 }])).toBe(0)
    const bins = calibrationBins(scored, 5)
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(scored.length)
  })
})

describe('규칙 + 확률 최종 판정(decideWithModel)', () => {
  const model = { ...createPriorModel(), threshold: 0.6 }
  const ev = (decision: CannedMatchEvaluation['decision'], f: CannedMatchFeatures): CannedMatchEvaluation => ({
    decision,
    best: decision === 'answer' ? ({ id: 'a1', title: 't', content: 'c', category: null, shortcut: null, match_keywords: [], usage_count: 0 }) : null,
    top: [{ id: 'a1', evidence: f.evidence, coverage: f.coverage, score: 1, passesRules: true, features: f }],
    reason: decision === 'answer' ? 'ok' : 'below_threshold',
    tokenCount: f.tokenCount,
  })
  it('규칙이 답변이 아니면 확률을 계산하지 않고 대기', () => {
    const v = decideWithModel(ev('no_match', base), model)
    expect(v).toMatchObject({ decision: 'wait', probability: null, reason: 'below_threshold' })
  })
  it('규칙이 답변이고 확률이 임계값 이상이면 답변', () => {
    const v = decideWithModel(ev('answer', feat({ coverage: 1, evidence: 5, gapToBest: 3 })), model)
    expect(v.decision).toBe('answer')
    expect(v.probability).toBeGreaterThanOrEqual(0.6)
  })
  it('규칙이 답변이어도 확률이 낮으면 대기(low_probability)', () => {
    const weak = feat({ coverage: 0.1, evidence: 1.2, gapToBest: -2, unexplainedContentTokens: 3, unexplainedVerbalRatio: 0.8 })
    const v = decideWithModel(ev('answer', weak), model)
    expect(v).toMatchObject({ decision: 'wait', reason: 'low_probability' })
    expect(v.probability).toBeLessThan(0.6)
  })
  it('선택된 후보가 상위 3개 밖이면 다른 후보의 특징값으로 판단하지 않고 대기', () => {
    const e = ev('answer', feat({ coverage: 1, evidence: 5, gapToBest: 3 }))
    e.best = { ...e.best!, id: 'not-in-top' }
    expect(decideWithModel(e, model)).toMatchObject({ decision: 'wait', probability: null, reason: 'best_not_in_top', bestId: 'not-in-top' })
  })
  it('관찰 기록은 고객 원문 없이 참조값만 담는다', () => {
    const e = ev('answer', feat({ coverage: 1, evidence: 5, gapToBest: 3 }))
    const rec = toObservationRecord('msg-123', e, decideWithModel(e, model), model)
    expect(Object.keys(rec).sort()).toEqual(['bestId', 'messageRef', 'modelDecision', 'modelVersion', 'probability', 'ruleDecision', 'ruleReason', 'top'].sort())
    expect(JSON.stringify(rec)).not.toContain('content')
  })
})

describe('직렬화·재현성', () => {
  it('parseModel 왕복', () => {
    const m = trainBatch(separable(60, 2))
    const back = parseModel(JSON.parse(JSON.stringify(m)))
    expect(back.weights).toEqual(m.weights)
    expect(back.bias).toBe(m.bias)
  })
  it('특징 목록이 다르거나 값이 비정상이면 거부한다', () => {
    const m = createPriorModel()
    expect(() => parseModel({ ...m, featureNames: ['x'] })).toThrow()
    expect(() => parseModel({ ...m, weights: m.weights.slice(1) })).toThrow()
    expect(() => parseModel({ ...m, bias: Number.NaN })).toThrow()
    expect(() => parseModel({ ...m, threshold: 1.5 })).toThrow()
    expect(() => parseModel({ ...m, threshold: Number.NaN })).toThrow()
    expect(() => parseModel(null)).toThrow()
  })
  it('저장된 학습 산출물(cannedMatchModel.weights.json)이 현재 코드와 호환된다', () => {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'src/lib/server/cannedMatchModel.weights.json'), 'utf-8'))
    const m = parseModel(raw)
    expect(m.threshold).toBeGreaterThan(0)
    expect(m.trainedSamples).toBeGreaterThan(100)
  })
  it('seededRandom·shuffled는 결정적이다', () => {
    const a = seededRandom(7)
    const b = seededRandom(7)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
    expect(shuffled([1, 2, 3, 4, 5, 6], 3)).toEqual(shuffled([1, 2, 3, 4, 5, 6], 3))
    expect(shuffled([1, 2, 3, 4, 5, 6], 3).slice().sort()).toEqual([1, 2, 3, 4, 5, 6])
  })
})
