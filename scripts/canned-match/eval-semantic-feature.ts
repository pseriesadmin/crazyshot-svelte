// eval-semantic-feature.ts — C-1 오프라인 비교: 확률 모델에 "의미 유사도" 특징을 더하면 정확도가 좋아지는가? (읽기 전용)
//
// 사용: PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/canned-match/eval-semantic-feature.ts [--seed 20261006]
//   · 합성 질문(synthetic.ts)을 규칙 판정에 재생해 "규칙이 답변으로 판정한 표본"을 만들고, 같은 표본으로
//     (A) 현행 특징 15개 (B) 현행 + semantic_cosine·semantic_cosine_full 17개 — 두 로지스틱을 그룹 5-fold 교차검증으로 비교한다.
//   · 의미 모델은 환경변수가 가리키는 DB(로컬 = Stage)의 허용 소스 말뭉치로 만든다. 실제 운영 모델 가중치(weights.json)는 건드리지 않는다.
//   · 이득이 있을 때만 새 가중치 반영을 제안한다(Stephen 관문). 출력에 고객 질문 원문은 없다(수치만).
import { createClient } from '@supabase/supabase-js'
import { loadCorpus, replay } from './dataset'
import { generateSynthetic } from './synthetic'
import { featureVector, sigmoid, rocAuc, brierScore, chooseThreshold, metricsAt, seededRandom, shuffled } from '../../src/lib/server/cannedMatchModel'
import { buildSemanticModel } from '../../src/lib/server/searchEngine/core/semanticVectors'
import { buildSemanticCorpus } from '../../src/lib/server/searchEngine/adapters/semanticCorpus'
import { loadSemanticCorpusInput } from '../../src/lib/server/searchEngine/adapters/semanticModelStore'
import { semanticCannedFeatures } from '../../src/lib/server/cannedSemanticFeature'

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const SEED = Number(arg('seed', '20261006'))
const K = 5
const TARGET = 0.95

interface Row { x: number[]; xs: number[]; label: 0 | 1; group: string; weight: number }

function fit(rows: { x: number[]; label: 0 | 1; weight: number }[], dim: number): { w: number[]; b: number } {
  const w = new Array<number>(dim).fill(0)
  let b = -2
  const lr = 0.5
  const l2 = 0.002
  const n = rows.length
  for (let epoch = 0; epoch < 1500; epoch++) {
    const gw = new Array<number>(dim).fill(0)
    let gb = 0
    for (const r of rows) {
      let z = b
      for (let j = 0; j < dim; j++) z += w[j] * r.x[j]
      const err = (sigmoid(z) - r.label) * r.weight
      for (let j = 0; j < dim; j++) gw[j] += err * r.x[j]
      gb += err
    }
    for (let j = 0; j < dim; j++) w[j] -= lr * (gw[j] / n + l2 * w[j])
    b -= lr * (gb / n)
  }
  return { w, b }
}
const predict = (m: { w: number[]; b: number }, x: number[]): number => sigmoid(m.w.reduce((a, wj, j) => a + wj * x[j], m.b))

async function main(): Promise<void> {
  const url = process.env.PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('PUBLIC_SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY 가 필요합니다')

  const model = buildSemanticModel(buildSemanticCorpus(await loadSemanticCorpusInput(createClient(url, key))).docs)
  const corpus = loadCorpus()
  const byId = new Map(corpus.canned.map((c) => [c.id, c]))
  const synthetic = generateSynthetic(corpus, { seed: SEED })
  const rep = replay(synthetic, corpus)

  const rows: Row[] = []
  for (const r of rep) {
    const ev = r.evaluation
    if (ev.decision !== 'answer' || !ev.best) continue
    const chosen = ev.top.find((t) => t.id === ev.best?.id) ?? ev.top[0]
    const canned = byId.get(ev.best.id)
    const sem = semanticCannedFeatures(model, r.item.query, canned ? { title: canned.title, content: canned.content, match_keywords: canned.match_keywords } : null)
    const base = featureVector(chosen.features)
    rows.push({
      x: base,
      xs: [...base, sem?.semantic_cosine ?? 0, sem?.semantic_cosine_full ?? 0],
      label: r.item.acceptable.includes(ev.best.id) ? 1 : 0,
      group: r.item.group,
      weight: r.item.weight ?? 1,
    })
  }
  console.log(`표본 ${rows.length}개 (정답 ${rows.filter((r) => r.label === 1).length} / 오답 ${rows.filter((r) => r.label === 0).length}) · 의미 모델 어휘 ${model.vocab.length}`)

  const groups = [...new Set(rows.map((r) => r.group))]
  const foldOf = new Map<string, number>()
  shuffled(groups, SEED).forEach((g, i) => foldOf.set(g, i % K))

  const evalSet = (useSem: boolean) => {
    const oof: { p: number; label: 0 | 1 }[] = []
    for (let k = 0; k < K; k++) {
      const pick = (r: Row): number[] => (useSem ? r.xs : r.x)
      const train = rows.filter((r) => foldOf.get(r.group) !== k)
      const test = rows.filter((r) => foldOf.get(r.group) === k)
      if (train.length === 0 || test.length === 0) continue
      const m = fit(train.map((r) => ({ x: pick(r), label: r.label, weight: r.weight })), pick(rows[0]).length)
      for (const t of test) oof.push({ p: predict(m, pick(t)), label: t.label })
    }
    const choice = chooseThreshold(oof, TARGET)
    const m = metricsAt(oof, choice.threshold)
    return { auc: rocAuc(oof), brier: brierScore(oof), choice, m }
  }
  void seededRandom
  const a = evalSet(false)
  const b = evalSet(true)
  const f = (n: number): string => n.toFixed(4)
  console.log('\n구분              | AUC     | Brier   | 목표 정밀도 달성 | 임계값 | 답변 수 | 재현율')
  for (const [name, r] of [['현행 15특징', a], ['+의미 2특징', b]] as const) {
    console.log(`${name.padEnd(16)} | ${f(r.auc)} | ${f(r.brier)} | ${r.choice.achieved ? '예' : '아니오'}          | ${f(r.choice.threshold)} | ${String(r.choice.answered).padStart(5)} | ${f(r.choice.recall)}`)
  }
  const gain = b.auc - a.auc
  console.log(
    gain > 0.005 || b.choice.recall > a.choice.recall + 0.01
      ? `\n판정: 이득 있음(AUC +${f(gain)}) — 새 가중치 반영은 Stephen 관문(운영 weights.json은 이 도구가 바꾸지 않음).`
      : '\n판정: 뚜렷한 이득 없음 — 가중치를 바꾸지 않습니다(관찰 기록만 계속).',
  )
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
