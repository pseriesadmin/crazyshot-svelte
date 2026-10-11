// eval-semantic.ts — B-5 의미 결합 효과 평가 (오프라인, 읽기 전용)
//
// 사용: NLSEARCH_EVAL_ANON=<프로덕션 anon 키> PUBLIC_SUPABASE_URL=<말뭉치 DB url> SUPABASE_SERVICE_ROLE_KEY=<말뭉치 DB 서비스 키> \
//        npx tsx scripts/nlsearch/eval-semantic.ts
//   · 평가 대상 상품 = 프로덕션 공개 상품(anon 읽기). 말뭉치 = 환경변수가 가리키는 DB(로컬 .env.local = Stage)의 허용 소스 7종,
//     단 상품은 프로덕션 공개 상품으로 교체한다(상품 어휘가 평가 문서와 같도록). 쓰기 없음.
//   · 글자 일치 점수(원점수, 분류 재정렬 이전) + weight × 의미 유사도 를 weight 격자로 비교한다. 지표 정의: helpers/searchEval.ts
//   · 합격 기준(Stephen 조정 가능): 기존 32질의 가드(모델명 1위·직접 질의 상위3·분류 질의 상위3)가 weight 0 대비 나빠지지 않고,
//     전체 recall@12·MRR·nDCG@12 중 개선이 있으며 0건 비율이 늘지 않는 weight 중 가장 이득이 큰 값. 없으면 "효과 없음".
import { createClient } from '@supabase/supabase-js'
import { createIndex } from '../../src/lib/server/searchEngine/core/createIndex'
import { buildSemanticModel } from '../../src/lib/server/searchEngine/core/semanticVectors'
import { buildProductDocs, buildCategoryLabelMap, PRODUCT_INDEX_CONFIG, type ProductDoc } from '../../src/lib/server/searchEngine/adapters/productSearchDocs'
import { buildSemanticCorpus } from '../../src/lib/server/searchEngine/adapters/semanticCorpus'
import { loadSemanticCorpusInput } from '../../src/lib/server/searchEngine/adapters/semanticModelStore'
import { blendScores, buildDocVectors, semanticDocText, semanticSimilarities } from '../../src/lib/server/searchEngine/adapters/semanticRank'
import { evaluate, evaluateRanking, type EvalHit } from '../../src/__tests__/helpers/searchEval'

const KEY = process.env.NLSEARCH_EVAL_ANON ?? ''
const BASE = 'https://vnbpmvxruyciuuaermyh.supabase.co/rest/v1'
const WEIGHTS = [0, 0.1, 0.2, 0.3, 0.5, 0.75, 1]

async function get(path: string): Promise<Record<string, unknown>[]> {
  const r = await fetch(`${BASE}/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return (await r.json()) as Record<string, unknown>[]
}

async function main(): Promise<void> {
  const url = process.env.PUBLIC_SUPABASE_URL
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!KEY || !url || !svc) throw new Error('NLSEARCH_EVAL_ANON · PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 가 필요합니다')

  const prodRows = await get(
    'products?select=id,name,brand,category,slug,product_caption,keywords,content_blocks,components,specifications&parent_product_id=is.null&is_active=eq.true&option_only=eq.false&deleted_at=is.null&limit=1000',
  )
  let labels = new Map<string, string[]>()
  try {
    labels = buildCategoryLabelMap(await get('code_mapping_groups?select=name,default_category&default_category=not.is.null'))
  } catch {
    /* 폴백 */
  }
  if (labels.size === 0) {
    labels = new Map([['camera', ['카메라']], ['lens', ['렌즈']], ['actcam', ['액션캠']], ['dronegim', ['드론/짐벌']], ['light', ['조명']], ['accessorie', ['악세서리']], ['hypepack', ['추천패키지']]])
  }
  const docs = buildProductDocs(prodRows, { categoryLabels: labels })
  const index = createIndex<ProductDoc>(PRODUCT_INDEX_CONFIG, docs)

  const input = await loadSemanticCorpusInput(createClient(url, svc))
  const corpus = buildSemanticCorpus({ ...input, products: prodRows })
  const model = buildSemanticModel(corpus.docs)
  const docVecs = buildDocVectors(model, docs.map((d) => ({ id: d.id, text: semanticDocText(d) })))
  console.log(`평가 상품 ${docs.length}개 · 말뭉치 문서 ${corpus.docs.length}개(${JSON.stringify(corpus.stats.docs)}) · 어휘 ${model.vocab.length} · 차원 ${model.dim}`)

  const searchAt = (weight: number) => {
    const lexicalOf = (q: string): EvalHit[] => index.search(q, { fuzzy: 0.2, prefix: true, limit: 300 }).map((r) => ({ id: r.document.id, score: r.score }))
    const blended = (q: string): EvalHit[] => blendScores(lexicalOf(q), semanticSimilarities(model, q, docVecs), weight).slice(0, 30)
    return { top: blended, wide: (q: string) => blendScores(lexicalOf(q), semanticSimilarities(model, q, docVecs), weight) }
  }

  const rows = WEIGHTS.map((w) => {
    const s = searchAt(w)
    return { w, rank: evaluateRanking(docs, s.top), guard: evaluate(docs, s.top, s.wide) }
  })
  const base = rows[0]
  const pct = (n: number): string => `${(n * 100).toFixed(1)}%`
  console.log('\nweight | recall@12 | MRR   | nDCG@12 | 0건   | 모델1위 | 직접3 | 분류3')
  for (const r of rows) {
    const o = r.rank.overall
    console.log(
      `${String(r.w).padEnd(6)} | ${o.recallAtK.toFixed(3)}     | ${o.mrr.toFixed(3)} | ${o.ndcgAtK.toFixed(3)}   | ${pct(o.zeroRate).padEnd(5)} | ${r.guard.modelTop1.ok}/${r.guard.modelTop1.total}     | ${r.guard.directTop3.ok}/${r.guard.directTop3.total}   | ${r.guard.categoryTop3.ok}/${r.guard.categoryTop3.total}`,
    )
  }

  const passing = rows.slice(1).filter((r) => {
    const o = r.rank.overall
    const b = base.rank.overall
    const guardOk = r.guard.modelTop1.ok >= base.guard.modelTop1.ok && r.guard.directTop3.ok >= base.guard.directTop3.ok && r.guard.categoryTop3.ok >= base.guard.categoryTop3.ok
    return guardOk && o.zeroRate <= b.zeroRate && (o.ndcgAtK > b.ndcgAtK + 0.003 || o.mrr > b.mrr + 0.003 || o.recallAtK > b.recallAtK + 0.003)
  })
  if (passing.length === 0) {
    console.log('\n판정: 효과 없음 — 합격 기준을 만족하는 weight가 없습니다(반영하지 않음).')
  } else {
    const best = passing.reduce((a, b) => (b.rank.overall.ndcgAtK > a.rank.overall.ndcgAtK ? b : a))
    console.log(`\n판정: 합격 후보 weight ${best.w} (nDCG@12 ${base.rank.overall.ndcgAtK.toFixed(3)} → ${best.rank.overall.ndcgAtK.toFixed(3)}). 켜기는 Stephen 승인 후.`)
    console.log('그룹별(후보 vs 0):')
    for (const [g, m] of Object.entries(best.rank.byGroup)) {
      const b = base.rank.byGroup[g]
      console.log(`  ${g.padEnd(10)} nDCG ${b.ndcgAtK.toFixed(3)} → ${m.ndcgAtK.toFixed(3)} · 0건 ${pct(b.zeroRate)} → ${pct(m.zeroRate)}`)
    }
  }
  const noise = rows[rows.length - 1].rank.unanswerableWithHits
  console.log(`\n취급 없음 질의 중 결과가 나온 것(weight 1.0): ${noise.length ? noise.join(', ') : '없음'} / (weight 0): ${base.rank.unanswerableWithHits.join(', ') || '없음'}`)
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
