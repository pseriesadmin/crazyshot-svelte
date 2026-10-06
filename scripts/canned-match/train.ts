// train.ts — 자동답변 확률 모델 학습·평가 (오프라인)
//
// 사용: npx tsx scripts/canned-match/train.ts [--eval <realEval.json>] [--target 0.97] [--seed 20261006] [--write] [--report <경로>] [--local-report <경로>]
//   · 합성 질문(synthetic.ts)으로 학습, 실제 고객 질문(--eval, 저장소 밖 로컬 파일)은 평가 전용
//   · 교차검증(그룹 단위 k-fold)의 "학습에 쓰지 않은 예측"으로 임계값을 정한다(낙관 편향 방지)
//   · --write 를 주면 src/lib/server/cannedMatchModel.weights.json 에 저장 (런타임에서는 아직 import하지 않는다)
import { readFileSync, writeFileSync } from 'node:fs'
import { loadCorpus, replay, toSamples, WEIGHTS_PATH } from './dataset'
import type { LabeledQuery, Replayed } from './dataset'
import { findLeaks, generateSynthetic } from './synthetic'
import {
  brierScore, calibrationBins, chooseThreshold, createPriorModel, decideWithModel, metricsAt, rocAuc, scoreSamples,
  seededRandom, shuffled, trainBatch,
} from '../../src/lib/server/cannedMatchModel'
import type { CannedMatchModel, Sample } from '../../src/lib/server/cannedMatchModel'

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`)

const TARGET = Number(arg('target', '0.95')) // 균형 기준(Stephen 확정) — 더 엄격히 하려면 --target 0.97
const SEED = Number(arg('seed', '20261006'))
const K = 5
// 확률 보정: 클래스 균형 가중은 확률을 낮게 왜곡해 기본 끔(--balance 로 켤 수 있음)
const TRAIN_OPTS = { balanceClasses: flag('balance'), epochs: 800 }
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`

// ── 데이터 ───────────────────────────────────────────────────────────────────
const corpus = loadCorpus()
let synthetic = generateSynthetic(corpus, { seed: SEED })

const evalPath = arg('eval')
let realEval: LabeledQuery[] = []
if (evalPath) {
  realEval = (JSON.parse(readFileSync(evalPath, 'utf-8')) as LabeledQuery[]).map((x) => ({ ...x }))
  const leaks = findLeaks(synthetic, realEval.map((r) => r.query))
  if (leaks.length > 0) {
    console.warn(`⚠️ 평가 질문과 겹치는 합성 질문 ${leaks.length}건을 학습에서 제외합니다`)
    const drop = new Set(leaks)
    synthetic = synthetic.filter((s) => !drop.has(s.query))
  }
}

const synReplay = replay(synthetic, corpus)
const synSamples = toSamples(synReplay)

// ── 규칙만 vs 합성 ───────────────────────────────────────────────────────────
function ruleStats(rep: Replayed[]): { total: number; expectAnswer: number; answered: number; correct: number; wrong: number; falseOnNone: number } {
  const expectAnswer = rep.filter((r) => r.item.acceptable.length > 0).length
  const answered = rep.filter((r) => r.evaluation.decision === 'answer')
  const correct = answered.filter((r) => r.evaluation.best && r.item.acceptable.includes(r.evaluation.best.id))
  return {
    total: rep.length, expectAnswer, answered: answered.length, correct: correct.length,
    wrong: answered.length - correct.length, falseOnNone: answered.filter((r) => r.item.acceptable.length === 0).length,
  }
}
const synRule = ruleStats(synReplay)

// ── 교차검증(그룹 단위) ──────────────────────────────────────────────────────
const groups = [...new Set(synSamples.map((s) => s.group))]
const foldOf = new Map<string, number>()
shuffled(groups, SEED).forEach((g, i) => foldOf.set(g, i % K))

const oof: { p: number; label: 0 | 1; kind: string }[] = []
for (let k = 0; k < K; k++) {
  const train: Sample[] = synSamples.filter((s) => foldOf.get(s.group) !== k).map((s) => s.sample)
  const test = synSamples.filter((s) => foldOf.get(s.group) === k)
  const model = trainBatch(train, TRAIN_OPTS)
  const scored = scoreSamples(model, test.map((t) => t.sample))
  scored.forEach((sc, i) => oof.push({ p: sc.p, label: sc.label, kind: test[i].kind }))
}
const oofScored = oof.map((o) => ({ p: o.p, label: o.label }))
const choice = chooseThreshold(oofScored, TARGET)
const cvMetrics = metricsAt(oofScored, choice.threshold)
const ruleOnlyPrecision = oof.filter((o) => o.label === 1).length / oof.length

// ── 최종 모델 ────────────────────────────────────────────────────────────────
const finalModel: CannedMatchModel = { ...trainBatch(synSamples.map((s) => s.sample), TRAIN_OPTS), threshold: choice.threshold }
const trainScored = scoreSamples(finalModel, synSamples.map((s) => s.sample))

// ── 실제 질문 평가 ───────────────────────────────────────────────────────────
interface RealRow { item: LabeledQuery; ruleDecision: string; ruleBest: string | null; p: number | null; modelAnswer: boolean; ruleCorrect: boolean; modelCorrect: boolean }
function evalReal(model: CannedMatchModel): { rows: RealRow[]; rule: ReturnType<typeof tally>; withModel: ReturnType<typeof tally> } {
  const rep = replay(realEval, corpus)
  const rows: RealRow[] = rep.map((r) => {
    const verdict = decideWithModel(r.evaluation, model)
    const ruleAns = r.evaluation.decision === 'answer'
    const ruleCorrect = ruleAns && !!r.evaluation.best && r.item.acceptable.includes(r.evaluation.best.id)
    const modelAnswer = verdict.decision === 'answer'
    return {
      item: r.item, ruleDecision: r.evaluation.decision, ruleBest: r.evaluation.best?.id ?? null, p: verdict.probability,
      modelAnswer, ruleCorrect, modelCorrect: modelAnswer && ruleCorrect,
    }
  })
  return { rows, rule: tally(rows, false), withModel: tally(rows, true) }
}
function tally(rows: RealRow[], useModel: boolean): { total: number; expectAnswer: number; answered: number; correct: number; wrong: number; falseOnNone: number; precision: number; recall: number; answerRate: number } {
  const answeredRows = rows.filter((r) => (useModel ? r.modelAnswer : r.ruleDecision === 'answer'))
  const correct = answeredRows.filter((r) => r.ruleCorrect).length
  const expectAnswer = rows.filter((r) => r.item.acceptable.length > 0).length
  return {
    total: rows.length, expectAnswer, answered: answeredRows.length, correct, wrong: answeredRows.length - correct,
    falseOnNone: answeredRows.filter((r) => r.item.acceptable.length === 0).length,
    precision: answeredRows.length ? correct / answeredRows.length : 0,
    recall: expectAnswer ? correct / expectAnswer : 0,
    answerRate: rows.length ? answeredRows.length / rows.length : 0,
  }
}

/** 부트스트랩 신뢰구간(정밀도) — 평가 표본이 작아 구간을 함께 보고한다 */
function bootstrapPrecision(rows: RealRow[], useModel: boolean, iters = 2000): [number, number] {
  const rnd = seededRandom(SEED + 7)
  const vals: number[] = []
  for (let i = 0; i < iters; i++) {
    const sample = rows.map(() => rows[Math.floor(rnd() * rows.length)])
    const t = tally(sample, useModel)
    if (t.answered > 0) vals.push(t.precision)
  }
  vals.sort((a, b) => a - b)
  if (vals.length === 0) return [0, 0]
  return [vals[Math.floor(vals.length * 0.025)], vals[Math.floor(vals.length * 0.975)]]
}

const real = realEval.length > 0 ? evalReal(finalModel) : null

// ── 출력 ─────────────────────────────────────────────────────────────────────
const lines: string[] = []
const out = (s = ''): number => lines.push(s)
const featureLine = finalModel.featureNames.map((n, i) => `${n}=${finalModel.weights[i].toFixed(2)}`).join(', ')

out('# 자동답변 확률 모델 학습 리포트 (오프라인·가상 관찰)')
out()
out(`> 생성: ${new Date().toISOString()} · 시드 ${SEED} · 목표 정밀도 ${pct(TARGET)} · 이 리포트에는 고객 질문 원문을 싣지 않는다(수치와 유형만).`)
out()
out('## 1. 데이터')
out(`- 빠른답변 코퍼스: ${corpus.canned.length}건 (Production 활성 스냅샷 2026-10-06)`)
out(`- 합성 질문: ${synthetic.length}건 (양성 ${synthetic.filter((s) => s.acceptable.length).length} / 음성 ${synthetic.filter((s) => !s.acceptable.length).length})`)
out(`- 규칙이 "답변"으로 판정해 학습 표본이 된 것: ${synSamples.length}건 (정답 ${synSamples.filter((s) => s.sample.label === 1).length} / 오답 ${synSamples.filter((s) => s.sample.label === 0).length})`)
out(`- 실제 고객 질문(평가 전용): ${realEval.length}건 (정답 있음 ${realEval.filter((r) => r.acceptable.length).length} / 정답 없음 ${realEval.filter((r) => !r.acceptable.length).length})`)
out()
out('## 2. 합성 데이터 — 규칙만 (현행)')
out(`- 답변 ${synRule.answered}건 중 정답 ${synRule.correct}건 → **정밀도 ${pct(synRule.correct / Math.max(1, synRule.answered))}**, 정답 있는 질문 중 정답 응답 ${pct(synRule.correct / Math.max(1, synRule.expectAnswer))}`)
out(`- 답하면 안 되는 질문에 답한 건수: ${synRule.falseOnNone}`)
out()
out(`## 3. 확률 모델 — ${K}-fold 교차검증 (그룹 단위, 학습에 쓰지 않은 예측)`)
out(`- AUC ${rocAuc(oofScored).toFixed(3)} · Brier ${brierScore(oofScored).toFixed(3)}`)
out(`- 선택한 임계값 τ=${choice.threshold.toFixed(3)} (목표 정밀도 ${choice.achieved ? '달성' : '**미달성**'})`)
out(`- τ 적용 시: 답변 ${cvMetrics.answered}/${cvMetrics.total} → **정밀도 ${pct(cvMetrics.precision)}** (규칙만 ${pct(ruleOnlyPrecision)}), 정답 보존율(재현) ${pct(cvMetrics.recall)}`)
out()
out('목표 정밀도별 임계값(교차검증 예측 기준) — 엄격도 선택의 근거:')
out()
out('| 목표 정밀도 | τ | 답변 | 정밀도 | 정답 보존율 |')
out('|---|---|---|---|---|')
for (const tp of [0.93, 0.95, 0.97, 0.98]) {
  const c = chooseThreshold(oofScored, tp)
  const m = metricsAt(oofScored, c.threshold)
  out(`| ${pct(tp)} | ${c.threshold.toFixed(3)} | ${m.answered}/${m.total} | ${pct(m.precision)}${c.achieved ? '' : ' (미달)'} | ${pct(m.recall)} |`)
}
out()
out('신뢰도 곡선(확률 구간별 평균 예측 vs 실제 정답률):')
out()
out('| 구간 | 건수 | 평균 예측 | 실제 정답률 |')
out('|---|---|---|---|')
for (const b of calibrationBins(oofScored, 5)) out(`| ${b.lo.toFixed(1)}–${b.hi.toFixed(1)} | ${b.count} | ${b.meanP.toFixed(2)} | ${b.count ? b.actualRate.toFixed(2) : '-'} |`)
out()
out('학습된 가중치(정규화 특징 기준): ' + featureLine + `, bias=${finalModel.bias.toFixed(2)}`)
out()
if (real) {
  const [rl, rh] = bootstrapPrecision(real.rows, false)
  const [ml, mh] = bootstrapPrecision(real.rows, true)
  const a = real.rule
  const b = real.withModel
  out('## 4. 실제 고객 질문 평가 (평가 전용, 정답표는 1차 수기 라벨 — 검수 전 잠정)')
  out()
  out('| | 규칙만 | 규칙+확률 모델 |')
  out('|---|---|---|')
  out(`| 자동 답변 건수 | ${a.answered}/${a.total} (${pct(a.answerRate)}) | ${b.answered}/${b.total} (${pct(b.answerRate)}) |`)
  out(`| 정답 응답 | ${a.correct} | ${b.correct} |`)
  out(`| 오답 응답 | ${a.wrong} | ${b.wrong} |`)
  out(`| 답하면 안 되는 질문에 답함 | ${a.falseOnNone} | ${b.falseOnNone} |`)
  out(`| 정밀도(답변 중 정답) | ${pct(a.precision)} [95% 구간 ${pct(rl)}–${pct(rh)}] | ${pct(b.precision)} [95% 구간 ${pct(ml)}–${pct(mh)}] |`)
  out(`| 재현(정답 있는 질문 중 정답 응답) | ${pct(a.recall)} | ${pct(b.recall)} |`)
  out()
  out('임계값 민감도(실제 질문, 참고용 — 임계값은 실제 질문으로 조정하지 않았다):')
  out()
  out('| τ | 답변 | 정답 | 오답 | 정밀도 |')
  out('|---|---|---|---|---|')
  for (const t of [0.3, 0.5, 0.7, 0.8, 0.9, choice.threshold]) {
    const ans = real.rows.filter((r) => r.ruleDecision === 'answer' && r.p !== null && r.p >= t)
    const ok = ans.filter((r) => r.ruleCorrect).length
    out(`| ${t.toFixed(2)}${t === choice.threshold ? ' (선택)' : ''} | ${ans.length} | ${ok} | ${ans.length - ok} | ${ans.length ? pct(ok / ans.length) : '-'} |`)
  }
  out()
}
out('## 5. 한계')
out('- 실제 평가 표본이 작고(직원 테스트·시스템 문구 포함) 정답표가 수기 1차 라벨이라 수치는 방향 확인용이다.')
out('- 합성 질문은 현재 빠른답변 42건에서 파생돼 실제 고객 표현 분포와 다르다. 관찰 모드 실가동 기록과 관리자 피드백이 이 모델을 보정한다.')
out('- 확률 모델은 규칙이 "답변"으로 판정한 후보만 다룬다 — 규칙이 놓친 질문을 되살리지는 못한다.')

const report = lines.join('\n')
console.log(report)
const reportPath = arg('report')
if (reportPath) writeFileSync(reportPath, report + '\n', 'utf-8')

// 실제 질문 원문이 들어 있는 상세(불일치·오답) 목록은 로컬 파일로만 남긴다
const localReport = arg('local-report')
if (real && localReport) {
  const l: string[] = ['# 로컬 전용 — 실제 질문 상세 (git에 올리지 말 것)', '']
  const title = new Map(corpus.canned.map((c) => [c.id, c.title.slice(0, 24)]))
  const section = (name: string, rows: RealRow[]): void => {
    l.push(`## ${name} (${rows.length})`, '')
    for (const r of rows) {
      l.push(`- [${r.item.n ?? ''}] ${r.item.query.slice(0, 60)} → 규칙:${r.ruleBest ? title.get(r.ruleBest) : '-'}(${r.ruleDecision}) p=${r.p === null ? '-' : r.p.toFixed(2)} 기대:${r.item.acceptable.map((i) => title.get(i)).join('/') || '없음'}`)
    }
    l.push('')
  }
  section('모델이 답변했지만 오답', real.rows.filter((r) => r.modelAnswer && !r.ruleCorrect))
  section('규칙은 답변했으나 모델이 거절(정답이었던 것)', real.rows.filter((r) => r.ruleDecision === 'answer' && !r.modelAnswer && r.ruleCorrect))
  section('규칙은 답변했으나 모델이 거절(오답이었던 것)', real.rows.filter((r) => r.ruleDecision === 'answer' && !r.modelAnswer && !r.ruleCorrect))
  section('정답이 있는데 답변하지 못함(미탐)', real.rows.filter((r) => r.item.acceptable.length > 0 && !r.modelAnswer))
  writeFileSync(localReport, l.join('\n') + '\n', 'utf-8')
}

if (flag('write')) {
  writeFileSync(WEIGHTS_PATH, JSON.stringify(finalModel, null, 2) + '\n', 'utf-8')
  console.log(`\n저장: ${WEIGHTS_PATH}`)
}
// 사전 지식 모델과의 비교(참고): 학습이 실제로 무엇을 바꿨는지
const prior = createPriorModel()
console.log('\n[참고] 사전 지식 모델 AUC(합성 전체):', rocAuc(scoreSamples(prior, synSamples.map((s) => s.sample))).toFixed(3), '/ 학습 모델 AUC(학습셋):', rocAuc(trainScored).toFixed(3))
