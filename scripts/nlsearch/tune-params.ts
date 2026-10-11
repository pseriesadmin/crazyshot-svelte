// tune-params.ts — 검색 가중치(boost·fuzzy) 튜닝 "제안" 도구 (오프라인, 읽기 전용)
//
// 사용: NLSEARCH_EVAL_ANON=<프로덕션 anon/publishable 키> npx tsx scripts/nlsearch/tune-params.ts [--rounds 2] [--out <경로>] [--save]
//   · 프로덕션 공개(anon RLS) 상품·분류 이름을 읽어 평가 세트(fixtures/nlsearchEvalQueries.json)로 좌표 탐색한다.
//   · ⛔ 자동 적용 없음: 결과는 표·JSON 파일로만 낸다. --save 를 주면 같은 값을 nlsearch_settings_history 에 'proposed'로 남기고
//     (SUPABASE_SERVICE_ROLE_KEY·PUBLIC_SUPABASE_URL 필요, 현재 값은 불변), CMS 검색 설정 화면에서 사람이 [적용]해야 반영된다.
//   · 목적함수 = (MRR + nDCG@12) / 2. 가드: 모델명 정확 질의 1위·직접 질의 상위3 유지·분류 질의 상위3 적합이 현재보다 나빠지면 그 후보는 버린다.
//   · 후기·학습 키워드·관리자 확인·동의어는 제외한 근사다(실서비스와 완전히 같지는 않음). 개선이 없으면 "개선 없음"으로 정상 종료한다.
import { writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { createIndex } from '../../src/lib/server/searchEngine/core/createIndex'
import {
  buildCategoryLabelMap,
  buildProductDocs,
  createCategoryIntentSearch,
  type ProductDoc,
} from '../../src/lib/server/searchEngine/adapters/productSearchDocs'
import {
  DEFAULT_NLSEARCH_PARAMS,
  PARAM_RANGES,
  resolveProductIndexConfig,
  type NlsearchParams,
} from '../../src/lib/server/searchEngine/adapters/nlsearchParamsSchema'
import { buildRecommendSearchTerms, extractRecommendQuery } from '../../src/lib/server/crazychat/recommend'
import { evaluate, evaluateRanking, type EvalHit } from '../../src/__tests__/helpers/searchEval'

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const KEY = process.env.NLSEARCH_EVAL_ANON ?? ''
const BASE = 'https://vnbpmvxruyciuuaermyh.supabase.co/rest/v1'
const ROUNDS = Number(arg('rounds', '2'))
const EPSILON = 0.002
const BOOST_CANDIDATES = [0, 0.5, 1, 2, 3, 4, 5, 6, 8, 10]
const FUZZY_CANDIDATES = [0.1, 0.15, 0.2, 0.25, 0.3]

async function get(path: string): Promise<Record<string, unknown>[]> {
  const r = await fetch(`${BASE}/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return (await r.json()) as Record<string, unknown>[]
}

function clone(p: NlsearchParams): NlsearchParams {
  return JSON.parse(JSON.stringify(p)) as NlsearchParams
}

async function main(): Promise<void> {
  if (!KEY) throw new Error('NLSEARCH_EVAL_ANON 환경변수(공개 anon/publishable 키)가 필요합니다')

  const rows = await get(
    'products?select=id,name,brand,category,slug,product_caption,keywords,content_blocks,components,specifications&parent_product_id=is.null&is_active=eq.true&option_only=eq.false&deleted_at=is.null&limit=1000',
  )
  let labels = new Map<string, string[]>()
  try {
    labels = buildCategoryLabelMap(await get('code_mapping_groups?select=name,default_category&default_category=not.is.null'))
  } catch {
    /* 아래 폴백 */
  }
  if (labels.size === 0) {
    labels = new Map([
      ['camera', ['카메라']], ['lens', ['렌즈']], ['actcam', ['액션캠']], ['dronegim', ['드론/짐벌']],
      ['light', ['조명']], ['accessorie', ['악세서리']], ['hypepack', ['추천패키지']],
    ])
  }
  const docs = buildProductDocs(rows, { categoryLabels: labels })

  const run = (params: NlsearchParams) => {
    const index = createIndex<ProductDoc>(resolveProductIndexConfig(params), docs)
    const intent = createCategoryIntentSearch(index, labels)
    const fuzzy = params.product.fuzzy
    const rec = (m: string): EvalHit[] => {
      const { query, tokens } = extractRecommendQuery(m)
      const q = query || m
      const merged = new Map<string, number>()
      const add = (t: string, w: number): void => {
        for (const r of intent(t, { fuzzy, prefix: params.product.prefix, limit: 30 })) merged.set(r.document.id, Math.max(merged.get(r.document.id) ?? 0, r.score * w))
      }
      for (const t of buildRecommendSearchTerms(q, query ? tokens : q.split(/\s+/), [])) add(t.q, t.weight)
      return [...merged.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score).slice(0, 15)
    }
    const wide = (q: string): EvalHit[] => index.search(q, { fuzzy, prefix: params.product.prefix, limit: 300 }).map((r) => ({ id: r.document.id, score: r.score }))
    const rank = evaluateRanking(docs, rec)
    const guard = evaluate(docs, rec, wide)
    return { rank, guard, objective: (rank.overall.mrr + rank.overall.ndcgAtK) / 2 }
  }

  const base = run(DEFAULT_NLSEARCH_PARAMS)
  const guardOk = (g: ReturnType<typeof run>['guard']): boolean =>
    g.modelTop1.ok >= base.guard.modelTop1.ok && g.directTop3.ok >= base.guard.directTop3.ok && g.categoryTop3.ok >= base.guard.categoryTop3.ok

  let best = clone(DEFAULT_NLSEARCH_PARAMS)
  let bestRun = base
  const changes: string[] = []

  for (let round = 1; round <= ROUNDS; round++) {
    let improved = false
    for (const field of Object.keys(best.product.boost)) {
      for (const v of BOOST_CANDIDATES) {
        if (v < PARAM_RANGES.boost.min || v > PARAM_RANGES.boost.max || v === best.product.boost[field]) continue
        const cand = clone(best)
        cand.product.boost[field] = v
        const r = run(cand)
        if (r.objective > bestRun.objective + EPSILON && guardOk(r.guard)) {
          changes.push(`R${round} boost.${field}: ${best.product.boost[field]} → ${v} (목적함수 ${bestRun.objective.toFixed(4)} → ${r.objective.toFixed(4)})`)
          best = cand
          bestRun = r
          improved = true
        }
      }
    }
    for (const v of FUZZY_CANDIDATES) {
      if (v === best.product.fuzzy) continue
      const cand = clone(best)
      cand.product.fuzzy = v
      const r = run(cand)
      if (r.objective > bestRun.objective + EPSILON && guardOk(r.guard)) {
        changes.push(`R${round} fuzzy: ${best.product.fuzzy} → ${v} (목적함수 ${bestRun.objective.toFixed(4)} → ${r.objective.toFixed(4)})`)
        best = cand
        bestRun = r
        improved = true
      }
    }
    if (!improved) break
  }

  const fmt = (m: { recallAtK: number; mrr: number; ndcgAtK: number; zeroRate: number }): string =>
    `recall@12 ${m.recallAtK.toFixed(3)} · MRR ${m.mrr.toFixed(3)} · nDCG@12 ${m.ndcgAtK.toFixed(3)} · 0건 ${(m.zeroRate * 100).toFixed(1)}%`
  console.log(`상품 ${docs.length}개 · 질의 ${base.rank.overall.n}개 채점`)
  console.log(`현재  : ${fmt(base.rank.overall)}`)
  console.log(`제안  : ${fmt(bestRun.rank.overall)}`)
  console.log(changes.length === 0 ? '\n개선 없음 — 현재 값을 유지하는 것이 최선입니다(정상 종료).' : `\n변경 제안:\n${changes.map((c) => `  - ${c}`).join('\n')}`)

  const proposal = {
    generated_at: new Date().toISOString(),
    baseline: base.rank.overall,
    proposed: bestRun.rank.overall,
    changes,
    params: best,
  }
  const out = arg('out')
  if (out) {
    writeFileSync(out, JSON.stringify(proposal, null, 2))
    console.log(`\n제안 파일 저장: ${out}`)
  }

  if (process.argv.includes('--save')) {
    if (changes.length === 0) {
      console.log('--save: 개선이 없어 제안을 남기지 않습니다.')
      return
    }
    const url = process.env.PUBLIC_SUPABASE_URL
    const svc = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !svc) throw new Error('--save 에는 PUBLIC_SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다')
    const { error } = await createClient(url, svc).rpc('cms_save_nlsearch_settings', {
      p_params: best,
      p_user_id: null,
      p_status: 'proposed',
      p_reason: `tune-params 제안 · nDCG@12 ${base.rank.overall.ndcgAtK.toFixed(3)} → ${bestRun.rank.overall.ndcgAtK.toFixed(3)}`,
    })
    if (error) throw new Error(error.message)
    console.log("제안을 이력에 'proposed'로 남겼습니다(현재 값 불변). CMS 검색 설정 화면에서 [적용]하면 반영됩니다.")
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
