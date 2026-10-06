// simulate-observation.ts — "가상 관찰 모드" 재생 + 관리자 피드백 온라인 학습 시뮬레이션 (오프라인)
//
// 사용: npx tsx scripts/canned-match/simulate-observation.ts --eval <realEval.json> [--out <records.jsonl>] [--report <md>] [--seed 777]
//
// 고객 채팅에는 연결하지 않는다. 실제로 관찰 모드가 켜졌을 때 쌓일 기록(ObservationRecord)과 같은 모양으로
//   A) 실제 질문(평가 전용)을 호출부와 같은 순서(규칙 → 확률 모델)로 재생해 기록하고,
//   B) 학습에 쓰지 않은 새 합성 질문 흐름(다른 시드)에서 일반화를 확인하고,
//   C) 관리자가 "정답/오답"을 눌러 주는 상황을 흉내 내 온라인 학습(sgdStep)이 실제로 성능을 바꾸는지 반복 분할로 검증한다.
import { readFileSync, writeFileSync } from 'node:fs'
import { loadCorpus, replay, WEIGHTS_PATH } from './dataset'
import type { LabeledQuery, Replayed } from './dataset'
import { generateSynthetic } from './synthetic'
import { decideWithModel, parseModel, seededRandom, sgdStep, toObservationRecord } from '../../src/lib/server/cannedMatchModel'
import type { CannedMatchModel, ObservationRecord } from '../../src/lib/server/cannedMatchModel'

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`

const model = parseModel(JSON.parse(readFileSync(WEIGHTS_PATH, 'utf-8')))
const corpus = loadCorpus()
const lines: string[] = []
const out = (s = ''): number => lines.push(s)

interface Tally { total: number; expectAnswer: number; answered: number; correct: number }
function tallyRows(rows: Replayed[], m: CannedMatchModel | null): Tally {
  let answered = 0
  let correct = 0
  for (const r of rows) {
    const ruleAns = r.evaluation.decision === 'answer'
    const ans = m ? decideWithModel(r.evaluation, m).decision === 'answer' : ruleAns
    if (!ans) continue
    answered++
    if (r.evaluation.best && r.item.acceptable.includes(r.evaluation.best.id)) correct++
  }
  return { total: rows.length, expectAnswer: rows.filter((r) => r.item.acceptable.length > 0).length, answered, correct }
}
const prec = (t: Tally): number => (t.answered ? t.correct / t.answered : 0)
const rec = (t: Tally): number => (t.expectAnswer ? t.correct / t.expectAnswer : 0)

out('# 가상 관찰 모드 재생 리포트')
out()
out(`> 생성: ${new Date().toISOString()} · 모델 v${model.version}(학습 표본 ${model.trainedSamples}건, τ=${model.threshold.toFixed(3)}) · 원문 질문 미포함`)
out()

// ── A) 실제 질문 재생 ────────────────────────────────────────────────────────
const evalPath = arg('eval')
let realRows: Replayed[] = []
if (evalPath) {
  const realEval = JSON.parse(readFileSync(evalPath, 'utf-8')) as LabeledQuery[]
  realRows = replay(realEval, corpus)
  const records: ObservationRecord[] = realRows.map((r) =>
    toObservationRecord(`real:${r.item.n ?? ''}`, r.evaluation, decideWithModel(r.evaluation, model), model),
  )
  const outPath = arg('out')
  if (outPath) writeFileSync(outPath, records.map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf-8')

  const by = (f: (x: ObservationRecord) => string): Record<string, number> => {
    const m: Record<string, number> = {}
    for (const x of records) m[f(x)] = (m[f(x)] ?? 0) + 1
    return m
  }
  out('## A. 실제 질문 재생 (관찰 기록 모양)')
  out()
  out(`- 기록 ${records.length}건 · 규칙 판정 ${JSON.stringify(by((x) => x.ruleDecision))} · 모델 판정 ${JSON.stringify(by((x) => x.modelDecision))}`)
  out(`- 대기 사유(규칙 단계 포함): ${JSON.stringify(by((x) => (x.modelDecision === 'wait' ? (x.probability === null ? x.ruleReason : 'low_probability') : '-')))}`)
  const rule = tallyRows(realRows, null)
  const withModel = tallyRows(realRows, model)
  out(`- 규칙만: 답변 ${rule.answered}건 정밀도 ${pct(prec(rule))} 재현 ${pct(rec(rule))} → 규칙+모델: 답변 ${withModel.answered}건 정밀도 ${pct(prec(withModel))} 재현 ${pct(rec(withModel))}`)
  out()
}

// ── B) 새 합성 질문 흐름(학습에 쓰지 않은 시드) ──────────────────────────────
const freshSeed = Number(arg('seed', '777'))
const fresh = replay(generateSynthetic(corpus, { seed: freshSeed }), corpus)
const fr = tallyRows(fresh, null)
const fm = tallyRows(fresh, model)
out(`## B. 새 합성 질문 흐름 (시드 ${freshSeed}, 학습에 쓰지 않음 — 같은 코퍼스 파생이라 낙관적 상한)`)
out()
out(`- 규칙만: 답변 ${fr.answered}/${fr.total} 정밀도 ${pct(prec(fr))} 재현 ${pct(rec(fr))}`)
out(`- 규칙+모델: 답변 ${fm.answered}/${fm.total} 정밀도 ${pct(prec(fm))} 재현 ${pct(rec(fm))}`)
out()

// ── C) 관리자 피드백 온라인 학습 시뮬레이션 ──────────────────────────────────
if (realRows.length > 0) {
  const REPEATS = 60
  const LR = Number(arg('lr', '0.3'))
  const PASSES = Number(arg('passes', '3'))
  const rnd = seededRandom(20261006)
  const agg = { static: { p: 0, r: 0, a: 0, n: 0 }, online: { p: 0, r: 0, a: 0, n: 0 } }
  for (let rep = 0; rep < REPEATS; rep++) {
    const idx = realRows.map((_, i) => i)
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      ;[idx[i], idx[j]] = [idx[j], idx[i]]
    }
    const half = Math.floor(idx.length / 2)
    const feedbackRows = idx.slice(0, half).map((i) => realRows[i])
    const testRows = idx.slice(half).map((i) => realRows[i])

    // 관리자는 규칙이 "답변"으로 제안한 후보에만 정답/오답을 누른다(관찰 모드 기록 검토)
    let online = model
    for (let pass = 0; pass < PASSES; pass++) {
      for (const r of feedbackRows) {
        if (r.evaluation.decision !== 'answer' || !r.evaluation.best) continue
        const chosen = r.evaluation.top.find((t) => t.id === r.evaluation.best?.id) ?? r.evaluation.top[0]
        const label = r.item.acceptable.includes(r.evaluation.best.id) ? 1 : 0
        online = sgdStep(online, chosen.features, label, { lr: LR, l2: 0.05, anchor: model })
      }
    }
    for (const [key, m] of [['static', model], ['online', online]] as const) {
      const t = tallyRows(testRows, m)
      agg[key].p += prec(t); agg[key].r += rec(t); agg[key].a += t.answered; agg[key].n++
    }
  }
  out(`## C. 관리자 피드백 온라인 학습 (실제 질문 반으로 나눠 ${REPEATS}회 반복 — 앞 절반=피드백, 뒤 절반=시험, lr=${LR}, ${PASSES}회 통과)`)
  out()
  out('| | 정밀도 | 재현 | 평균 답변 건수 |')
  out('|---|---|---|---|')
  for (const key of ['static', 'online'] as const) {
    const a = agg[key]
    out(`| ${key === 'static' ? '사전학습만(피드백 없음)' : '피드백 반영(온라인)'} | ${pct(a.p / a.n)} | ${pct(a.r / a.n)} | ${(a.a / a.n).toFixed(1)} |`)
  }
  out()
  out('- 앵커(사전학습 가중치로 당김)가 있어 피드백 소량으로는 모델이 크게 변하지 않는다. 표본이 작아 차이는 방향 확인용이다.')
}

const report = lines.join('\n')
console.log(report)
const reportPath = arg('report')
if (reportPath) writeFileSync(reportPath, report + '\n', 'utf-8')
