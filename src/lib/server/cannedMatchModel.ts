// cannedMatchModel.ts — 자동답변 "이 답변이 맞을 확률" 모델 (순수 TypeScript, 외부 라이브러리 없음)
//
// 배경(2026-10-06): 규칙 판정(matchCannedResponse.evaluateCannedMatch)은 근거·커버리지 기준값을 사람이 정한 값으로
//   쓴다. 이 모듈은 같은 판정이 이미 계산하는 특징값(CannedMatchFeatures)으로 "채택된 답변이 실제 정답일 확률"을
//   로지스틱 회귀로 학습한다. 최종 판정 = 규칙 게이트(안전 하한) ∧ 확률 ≥ 임계값.
//   규칙 게이트는 그대로 두므로 모델이 틀려도 "일반어만·비질문·핵심 단어 미설명" 같은 최소 안전선은 유지된다.
//
// 학습 방식
//   · 일괄 학습: trainBatch — 합성 데이터(scripts/canned-match)로 사전학습
//   · 온라인 학습: sgdStep — 관리자 피드백(정답/오답) 1건씩 반영. 사전학습 가중치로 당기는 앵커(L2)가 있어
//     소수의 피드백이 모델을 망가뜨리지 못한다(DB 저장·피드백 버튼은 다음 단계, 이 파일은 순수함수만 제공)
//   · 순수함수 원칙: DB·파일·네트워크를 직접 쓰지 않는다(nlsearch.md §6).

import type { CannedMatchEvaluation, CannedMatchFeatures } from './matchCannedResponse'

// ── 특징 벡터 ────────────────────────────────────────────────────────────────

export const FEATURE_NAMES = [
  'evidence', 'coverage', 'concepts', 'curatedConcepts', 'curatedHit', 'titleOnly', 'shortcutHit',
  'maxTermLen', 'tokenCount', 'nonGenericRatio', 'contentBonus', 'unexplainedVerbalRatio', 'unexplainedContentTokens', 'gapToBest', 'evidenceXcoverage',
] as const

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

/** 특징값을 대략 0~1 범위로 정규화한 벡터 — FEATURE_NAMES 순서 */
export function featureVector(f: CannedMatchFeatures): number[] {
  const evidence = clamp(f.evidence, 0, 8) / 8
  return [
    evidence,
    clamp(f.coverage, 0, 1),
    clamp(f.concepts, 0, 5) / 5,
    clamp(f.curatedConcepts, 0, 5) / 5,
    f.curatedHit,
    f.titleOnly,
    f.shortcutHit,
    clamp(f.maxTermLen, 0, 8) / 8,
    clamp(f.tokenCount, 0, 10) / 10,
    clamp(f.nonGenericRatio, 0, 1),
    clamp(f.contentBonus, 0, 0.6) / 0.6,
    clamp(f.unexplainedVerbalRatio, 0, 1),
    clamp(f.unexplainedContentTokens, 0, 4) / 4,
    clamp(f.gapToBest, -4, 6) / 6,
    evidence * clamp(f.coverage, 0, 1),
  ]
}

// ── 모델 ─────────────────────────────────────────────────────────────────────

export interface CannedMatchModel {
  version: number
  featureNames: string[]
  weights: number[]
  bias: number
  /** 이 확률 이상이면 자동 답변 */
  threshold: number
  trainedAt: string
  trainedSamples: number
}

export const MODEL_VERSION = 1

export function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z))
  const e = Math.exp(z)
  return e / (1 + e)
}

export function predictProbability(model: CannedMatchModel, f: CannedMatchFeatures): number {
  const x = featureVector(f)
  let z = model.bias
  for (let i = 0; i < x.length; i++) z += model.weights[i] * x[i]
  return sigmoid(z)
}

/**
 * 사전 지식 모델 — 규칙 판정의 방향성(커버리지·근거가 높을수록, 제목 단독·미설명 서술어가 많을수록 낮게)을
 * 가중치로 옮긴 출발점. 학습의 초기값이자 온라인 학습의 앵커.
 */
export function createPriorModel(): CannedMatchModel {
  return {
    version: MODEL_VERSION,
    featureNames: [...FEATURE_NAMES],
    //          evid  cov  conc curC cHit tOnly sc  tLen tok  ngr  cont verb unexC gap  e×c
    weights: [1.2, 3.0, 1.0, 1.0, 0.8, -1.0, 0.8, 0.5, -0.3, 0.8, 0.2, -1.0, -1.2, 1.2, 1.5],
    bias: -4.0,
    threshold: 0.5,
    trainedAt: new Date(0).toISOString(),
    trainedSamples: 0,
  }
}

export interface Sample {
  features: CannedMatchFeatures
  /** 1 = 채택된 답변이 정답, 0 = 오답 */
  label: 0 | 1
  /** 표본 가중치(기본 1) */
  weight?: number
}

export interface TrainOptions {
  epochs?: number
  lr?: number
  l2?: number
  /** 클래스 불균형 보정(정답·오답 비중을 같게) */
  balanceClasses?: boolean
  /** 시작 모델(없으면 사전 지식 모델) */
  init?: CannedMatchModel
  /** 사전 지식 가중치로 당기는 세기(0이면 영점으로 당김 = 일반 L2) */
  anchorToInit?: boolean
}

/** 전체 배치 경사하강으로 로지스틱 회귀를 학습한다(결정적: 같은 입력 → 같은 가중치). */
export function trainBatch(samples: Sample[], opts: TrainOptions = {}): CannedMatchModel {
  const { epochs = 600, lr = 0.8, l2 = 0.002, balanceClasses = true, anchorToInit = false } = opts
  const base = opts.init ?? createPriorModel()
  const n = samples.length
  const model: CannedMatchModel = { ...base, weights: [...base.weights], featureNames: [...base.featureNames] }
  if (n === 0) return model

  const pos = samples.filter((s) => s.label === 1).length
  const neg = n - pos
  const wPos = balanceClasses && pos > 0 ? n / (2 * pos) : 1
  const wNeg = balanceClasses && neg > 0 ? n / (2 * neg) : 1
  const xs = samples.map((s) => featureVector(s.features))
  const sw = samples.map((s) => (s.weight ?? 1) * (s.label === 1 ? wPos : wNeg))
  const totalW = sw.reduce((a, b) => a + b, 0)
  const anchor = base.weights

  for (let epoch = 0; epoch < epochs; epoch++) {
    const grad = new Array<number>(model.weights.length).fill(0)
    let gradB = 0
    for (let i = 0; i < n; i++) {
      let z = model.bias
      for (let j = 0; j < grad.length; j++) z += model.weights[j] * xs[i][j]
      const err = (sigmoid(z) - samples[i].label) * sw[i]
      for (let j = 0; j < grad.length; j++) grad[j] += err * xs[i][j]
      gradB += err
    }
    for (let j = 0; j < grad.length; j++) {
      const reg = anchorToInit ? model.weights[j] - anchor[j] : model.weights[j]
      model.weights[j] -= lr * (grad[j] / totalW + l2 * reg)
    }
    model.bias -= lr * (gradB / totalW)
  }
  model.trainedAt = new Date().toISOString()
  model.trainedSamples = n
  return model
}

export interface SgdOptions {
  lr?: number
  l2?: number
  /** 당겨질 기준 가중치(보통 사전학습된 모델). 없으면 현재 모델 자신 */
  anchor?: CannedMatchModel
}

/**
 * 관리자 피드백 1건(정답=1/오답=0)을 반영한 새 모델을 돌려준다(원본 불변).
 * 앵커 정규화 때문에 피드백이 적을 때는 사전학습 모델에서 크게 벗어나지 않고, 쌓일수록 서서히 이동한다.
 */
export function sgdStep(model: CannedMatchModel, f: CannedMatchFeatures, label: 0 | 1, opts: SgdOptions = {}): CannedMatchModel {
  const { lr = 0.15, l2 = 0.05 } = opts
  const anchor = opts.anchor ?? model
  const x = featureVector(f)
  const err = predictProbability(model, f) - label
  const weights = model.weights.map((w, j) => w - lr * (err * x[j] + l2 * (w - anchor.weights[j])))
  const bias = model.bias - lr * (err + l2 * (model.bias - anchor.bias))
  return { ...model, weights, bias, trainedSamples: model.trainedSamples + 1 }
}

// ── 평가·임계값 ──────────────────────────────────────────────────────────────

export interface ScoredSample {
  p: number
  label: 0 | 1
}

export function scoreSamples(model: CannedMatchModel, samples: Sample[]): ScoredSample[] {
  return samples.map((s) => ({ p: predictProbability(model, s.features), label: s.label }))
}

export interface ThresholdChoice {
  threshold: number
  precision: number
  answered: number
  recall: number
  /** 목표 정밀도를 실제로 달성했는지 */
  achieved: boolean
}

/**
 * 목표 정밀도(답변한 것 중 정답 비율)를 만족하는 가장 낮은 임계값을 고른다(= 목표를 지키면서 가장 많이 답변).
 * 달성할 수 없으면 정밀도가 가장 높은 임계값을 고르고 achieved=false.
 */
export function chooseThreshold(scored: ScoredSample[], targetPrecision: number, minAnswered = 5): ThresholdChoice {
  const totalPos = scored.filter((s) => s.label === 1).length
  const sorted = [...scored].sort((a, b) => b.p - a.p)
  let best: ThresholdChoice | null = null
  let fallback: ThresholdChoice | null = null
  let tp = 0
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].label === 1) tp++
    const answered = i + 1
    // 같은 확률끼리는 한꺼번에 포함
    if (i + 1 < sorted.length && sorted[i + 1].p === sorted[i].p) continue
    const precision = tp / answered
    const candidate: ThresholdChoice = {
      threshold: sorted[i].p,
      precision,
      answered,
      recall: totalPos > 0 ? tp / totalPos : 0,
      achieved: precision >= targetPrecision,
    }
    if (answered >= minAnswered) {
      if (candidate.achieved) best = candidate // 내려갈수록 더 많이 답변 → 마지막으로 달성한 것을 유지
      if (!fallback || precision > fallback.precision) fallback = candidate
    }
  }
  return best ?? fallback ?? { threshold: 1, precision: 0, answered: 0, recall: 0, achieved: false }
}

export interface Metrics {
  answered: number
  total: number
  precision: number
  recall: number
  answerRate: number
}

export function metricsAt(scored: ScoredSample[], threshold: number): Metrics {
  const totalPos = scored.filter((s) => s.label === 1).length
  const answered = scored.filter((s) => s.p >= threshold)
  const tp = answered.filter((s) => s.label === 1).length
  return {
    answered: answered.length,
    total: scored.length,
    precision: answered.length > 0 ? tp / answered.length : 0,
    recall: totalPos > 0 ? tp / totalPos : 0,
    answerRate: scored.length > 0 ? answered.length / scored.length : 0,
  }
}

export interface CalibrationBin {
  lo: number
  hi: number
  count: number
  meanP: number
  actualRate: number
}

/** 신뢰도 곡선 — 확률 구간별 평균 예측 확률과 실제 정답률(잘 보정됐다면 둘이 비슷) */
export function calibrationBins(scored: ScoredSample[], bins = 5): CalibrationBin[] {
  const out: CalibrationBin[] = []
  for (let b = 0; b < bins; b++) {
    const lo = b / bins
    const hi = (b + 1) / bins
    const inBin = scored.filter((s) => s.p >= lo && (b === bins - 1 ? s.p <= hi : s.p < hi))
    out.push({
      lo, hi, count: inBin.length,
      meanP: inBin.length ? inBin.reduce((a, s) => a + s.p, 0) / inBin.length : 0,
      actualRate: inBin.length ? inBin.filter((s) => s.label === 1).length / inBin.length : 0,
    })
  }
  return out
}

/** 순위 품질(AUC) — 정답이 오답보다 높은 확률을 받는 비율 */
export function rocAuc(scored: ScoredSample[]): number {
  const pos = scored.filter((s) => s.label === 1)
  const neg = scored.filter((s) => s.label === 0)
  if (pos.length === 0 || neg.length === 0) return 0.5
  let wins = 0
  for (const p of pos) for (const n of neg) wins += p.p > n.p ? 1 : p.p === n.p ? 0.5 : 0
  return wins / (pos.length * neg.length)
}

export function brierScore(scored: ScoredSample[]): number {
  if (scored.length === 0) return 0
  return scored.reduce((a, s) => a + (s.p - s.label) ** 2, 0) / scored.length
}

// ── 최종 판정 (규칙 게이트 ∧ 확률) ───────────────────────────────────────────

export type ModelDecision = 'answer' | 'wait'

export interface ModelVerdict {
  decision: ModelDecision
  /** 규칙 게이트를 통과해 확률이 계산된 경우에만 존재 */
  probability: number | null
  bestId: string | null
  /** ok | low_probability | best_not_in_top | 규칙 판정 사유(below_threshold·ambiguous·non_question…) */
  reason: string
}

/**
 * 규칙 판정 결과에 확률 모델을 덧씌운 최종 판정. 규칙이 answer가 아니면 확률을 계산하지 않고 바로 wait.
 * 규칙이 answer면 선택된 후보의 특징값으로 확률을 구해 임계값과 비교한다.
 */
export function decideWithModel(evaluation: CannedMatchEvaluation, model: CannedMatchModel): ModelVerdict {
  if (evaluation.decision !== 'answer' || !evaluation.best) {
    return { decision: 'wait', probability: null, bestId: null, reason: evaluation.reason }
  }
  const chosen = evaluation.top.find((t) => t.id === evaluation.best?.id)
  // 근소한 점수 차 후보가 많아 사용횟수로 고른 답이 상위 3개 밖이면 특징값이 없다 — 엉뚱한 후보의 값으로 판단하지 않고 대기
  if (!chosen) return { decision: 'wait', probability: null, bestId: evaluation.best.id, reason: 'best_not_in_top' }
  const p = predictProbability(model, chosen.features)
  if (p >= model.threshold) return { decision: 'answer', probability: p, bestId: evaluation.best.id, reason: 'ok' }
  return { decision: 'wait', probability: p, bestId: evaluation.best.id, reason: 'low_probability' }
}

/** 관찰 모드 1건의 기록 모양 — 나중 DB 테이블과 같은 형태(고객 원문은 message_id로만 참조) */
export interface ObservationRecord {
  messageRef: string
  ruleDecision: CannedMatchEvaluation['decision']
  ruleReason: string
  modelDecision: ModelDecision
  probability: number | null
  bestId: string | null
  top: { id: string; score: number; passesRules: boolean }[]
  modelVersion: number
}

export function toObservationRecord(messageRef: string, evaluation: CannedMatchEvaluation, verdict: ModelVerdict, model: CannedMatchModel): ObservationRecord {
  return {
    messageRef,
    ruleDecision: evaluation.decision,
    ruleReason: evaluation.reason,
    modelDecision: verdict.decision,
    probability: verdict.probability === null ? null : Math.round(verdict.probability * 1000) / 1000,
    bestId: verdict.bestId,
    top: evaluation.top.map((t) => ({ id: t.id, score: t.score, passesRules: t.passesRules })),
    modelVersion: model.version,
  }
}

// ── 직렬화 ───────────────────────────────────────────────────────────────────

/** JSON(파일·DB)에서 읽은 값을 검증해 모델로 만든다. 모양이 다르면 에러. */
export function parseModel(raw: unknown): CannedMatchModel {
  const m = raw as Partial<CannedMatchModel> | null
  if (!m || typeof m !== 'object') throw new Error('모델 JSON이 객체가 아닙니다')
  if (!Array.isArray(m.weights) || !Array.isArray(m.featureNames)) throw new Error('weights/featureNames 누락')
  if (m.weights.length !== FEATURE_NAMES.length || m.featureNames.join() !== FEATURE_NAMES.join()) {
    throw new Error('특징 목록이 현재 코드와 다릅니다 — 재학습이 필요합니다')
  }
  if (!m.weights.every((w) => typeof w === 'number' && Number.isFinite(w))) throw new Error('weights에 숫자가 아닌 값이 있습니다')
  if (typeof m.bias !== 'number' || !Number.isFinite(m.bias)) throw new Error('bias 오류')
  if (typeof m.threshold !== 'number' || !Number.isFinite(m.threshold) || m.threshold < 0 || m.threshold > 1) throw new Error('threshold 오류')
  return {
    version: typeof m.version === 'number' ? m.version : MODEL_VERSION,
    featureNames: [...m.featureNames],
    weights: [...m.weights],
    bias: m.bias,
    threshold: m.threshold,
    trainedAt: typeof m.trainedAt === 'string' ? m.trainedAt : new Date(0).toISOString(),
    trainedSamples: typeof m.trainedSamples === 'number' ? m.trainedSamples : 0,
  }
}

// ── 재현 가능한 난수·분할(학습 스크립트·테스트 공용) ─────────────────────────

/** mulberry32 — 시드 고정 난수(0~1) */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const rnd = seededRandom(seed)
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
