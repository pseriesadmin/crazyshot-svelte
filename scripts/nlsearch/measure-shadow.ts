// measure-shadow.ts — 의미 점수 관찰 기록의 계산·기록 시간 측정(환경변수가 가리키는 DB, 로컬 = Stage)
// 사용: PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/nlsearch/measure-shadow.ts
//   · 검색 API의 observeShadow와 같은 계산(모델 로드 → 문서 임베딩 → 유사도 → 결합 비교)과 같은 행 기록을 질의마다 수행하고 시간을 잰다.
//   · source='search_api' 행이 실제로 쌓인다(원문·상품명 없음). 개발 서버 없이 지연 상한을 가늠하는 용도.
import { createClient } from '@supabase/supabase-js'
import { createIndex } from '../../src/lib/server/searchEngine/core/createIndex'
import { buildProductDocs, PRODUCT_INDEX_CONFIG, type ProductDoc } from '../../src/lib/server/searchEngine/adapters/productSearchDocs'
import { loadLatestSemanticModel } from '../../src/lib/server/searchEngine/adapters/semanticModelStore'
import { buildDocVectors, computeShadowObservation, semanticDocText, semanticSimilarities } from '../../src/lib/server/searchEngine/adapters/semanticRank'
import raw from '../../src/__tests__/fixtures/nlsearchEvalQueries.json'

const QUERIES = (raw as { q: string }[]).map((x) => x.q).slice(0, 60)

async function main(): Promise<void> {
  const url = process.env.PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('PUBLIC_SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY 필요')
  const admin = createClient(url, key)

  const t0 = Date.now()
  const model = await loadLatestSemanticModel(admin)
  const tModel = Date.now() - t0
  if (!model) throw new Error('모델 없음')
  const { data } = await admin.from('products').select('id, name, brand, category, slug, product_caption, keywords, content_blocks, components, specifications').is('parent_product_id', null).eq('is_active', true).eq('option_only', false).is('deleted_at', null)
  const docs = buildProductDocs((data ?? []) as Record<string, unknown>[])
  const index = createIndex<ProductDoc>(PRODUCT_INDEX_CONFIG, docs)
  const t1 = Date.now()
  const vecs = buildDocVectors(model, docs.map((d) => ({ id: d.id, text: semanticDocText(d) })))
  const tDocs = Date.now() - t1

  const times: number[] = []
  const rows: number[] = []
  let fillZero = 0
  for (const q of QUERIES) {
    const s = Date.now()
    const sims = semanticSimilarities(model, q, vecs)
    const lexical = index.search(q, { fuzzy: 0.2, prefix: true, limit: 300 }).map((r) => ({ id: r.document.id, score: r.score }))
    const current = lexical.slice(0, 12).map((x) => x.id)
    const o = computeShadowObservation({ currentIds: current, lexical, sims, weight: 0.3, k: 12 })
    const compute = Date.now() - s
    const { error } = await admin.from('nlsearch_shadow_observations').insert({
      source: 'search_api', search_log_id: null, query_chars: q.length, result_count_current: o.resultCountCurrent, result_count_blend: o.resultCountBlend,
      overlap_k: o.overlapK, new_entrants: o.newEntrants, dropped: o.dropped, top1_same: o.top1Same, would_fill_zero: o.wouldFillZero, weight: o.weight,
      model_vocab: model.vocab.length, latency_ms: compute,
    })
    if (error) throw new Error(error.message)
    times.push(Date.now() - s)
    rows.push(compute)
    if (o.wouldFillZero) fillZero++
  }
  const pct = (a: number[], p: number): number => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))]
  console.log(JSON.stringify({ queries: QUERIES.length, modelLoadMs: tModel, docVectorsMs: tDocs, computeMs: { p50: pct(rows, 0.5), p95: pct(rows, 0.95), max: Math.max(...rows) }, computePlusInsertMs: { p50: pct(times, 0.5), p95: pct(times, 0.95), max: Math.max(...times) }, wouldFillZero: fillZero }))
}
main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1) })
