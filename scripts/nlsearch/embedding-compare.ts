// embedding-compare.ts — D-1 외부 임베딩 vs 자체 의미 벡터(B) 오프라인 비교 (읽기 전용, 운영 코드 변경 없음)
//
// 사용:
//   점검(키 불필요, 가짜 임베딩 — 품질 비교 아님): NLSEARCH_EVAL_ANON=<anon키> npx tsx scripts/nlsearch/embedding-compare.ts --dry
//   실행: NLSEARCH_EVAL_ANON=<anon키> EMBED_API_KEY=<제공자 키> [EMBED_BASE_URL=https://api.openai.com/v1] [EMBED_MODEL=text-embedding-3-small] \
//         [PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=…(자체 모델 B 비교용, 로컬 = Stage)] npx tsx scripts/nlsearch/embedding-compare.ts [--out <리포트.md>]
//
// ⛔ 전송 데이터 범위(Stephen 승인 D-0): "공개 상품 텍스트"(이름·브랜드·한 줄 설명·키워드·분류 이름·구성품·사양)와 평가 질의 150개(합성·공개 문구, 고객 원문 아님)뿐.
//    후기·크레이지로그·댓글·채팅·검색 로그·회원 정보는 절대 보내지 않는다. API 키는 환경변수로만 받고 출력·저장하지 않는다.
// 비교 방식: 글자 일치(원점수) + weight × 유사도. 외부 코사인은 질의별 "평균+표준편차" 이상만 0.3~1.0으로 정규화(embedding-utils.normalizeSims).
//    구성: 글자만 / 자체(B) / 외부 / 자체+외부 평균. 지표: helpers/searchEval.ts evaluateRanking + 가드(모델명 1위·직접 질의 상위3·분류 질의 상위3).
import { writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { createIndex } from '../../src/lib/server/searchEngine/core/createIndex'
import { buildSemanticModel } from '../../src/lib/server/searchEngine/core/semanticVectors'
import { buildProductDocs, buildCategoryLabelMap, PRODUCT_INDEX_CONFIG, type ProductDoc } from '../../src/lib/server/searchEngine/adapters/productSearchDocs'
import { buildSemanticCorpus } from '../../src/lib/server/searchEngine/adapters/semanticCorpus'
import { loadSemanticCorpusInput } from '../../src/lib/server/searchEngine/adapters/semanticModelStore'
import { blendScores, buildDocVectors, semanticDocText, semanticSimilarities } from '../../src/lib/server/searchEngine/adapters/semanticRank'
import { DEFAULT_EVAL_QUERIES, evaluate, evaluateRanking, type EvalHit } from '../../src/__tests__/helpers/searchEval'
import { averageSims, buildEmbeddingRequest, dot, fakeEmbed, normalizeSims, parseEmbeddingResponse, type EmbedConfig } from './embedding-utils'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const DRY = process.argv.includes('--dry')
const KEY = process.env.NLSEARCH_EVAL_ANON ?? ''
const BASE = 'https://vnbpmvxruyciuuaermyh.supabase.co/rest/v1'
const WEIGHTS = [0.1, 0.2, 0.3, 0.5, 0.75, 1]
const BATCH = 64

async function get(path: string): Promise<Record<string, unknown>[]> {
  const r = await fetch(`${BASE}/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return (await r.json()) as Record<string, unknown>[]
}

async function embedAll(cfg: EmbedConfig, texts: readonly string[]): Promise<Float32Array[]> {
  const out: Float32Array[] = []
  for (let i = 0; i < texts.length; i += BATCH) {
    const body = buildEmbeddingRequest(cfg.model, texts.slice(i, i + BATCH))
    let lastErr = ''
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        out.push(...parseEmbeddingResponse(await res.json(), body.input.length))
        lastErr = ''
        break
      }
      lastErr = `${res.status}` // 응답 본문은 출력하지 않는다(요청 내용이 에코될 수 있음)
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
    }
    if (lastErr) throw new Error(`임베딩 요청 실패(HTTP ${lastErr})`)
  }
  return out
}

async function main(): Promise<void> {
  if (!KEY) throw new Error('NLSEARCH_EVAL_ANON(프로덕션 공개 anon 키) 필요')
  const cfg: EmbedConfig = {
    baseUrl: process.env.EMBED_BASE_URL ?? 'https://api.openai.com/v1',
    model: process.env.EMBED_MODEL ?? 'text-embedding-3-small',
    apiKey: process.env.EMBED_API_KEY ?? '',
  }
  if (!DRY && !cfg.apiKey) throw new Error('EMBED_API_KEY 필요(키 없이 점검만 하려면 --dry)')

  // 공개 상품만(anon RLS) — 후기·글·댓글 등은 읽지도 않는다
  const prodRows = await get('products?select=id,name,brand,category,slug,product_caption,keywords,content_blocks,components,specifications&parent_product_id=is.null&is_active=eq.true&option_only=eq.false&deleted_at=is.null&limit=1000')
  let labels = new Map<string, string[]>()
  try {
    labels = buildCategoryLabelMap(await get('code_mapping_groups?select=name,default_category&default_category=not.is.null'))
  } catch { /* 폴백 */ }
  if (labels.size === 0) labels = new Map([['camera', ['카메라']], ['lens', ['렌즈']], ['actcam', ['액션캠']], ['dronegim', ['드론/짐벌']], ['light', ['조명']], ['accessorie', ['악세서리']], ['hypepack', ['추천패키지']]])
  const docs = buildProductDocs(prodRows, { categoryLabels: labels })
  const index = createIndex<ProductDoc>(PRODUCT_INDEX_CONFIG, docs)

  const docTexts = docs.map((d) => semanticDocText(d))
  const queries = DEFAULT_EVAL_QUERIES.map((x) => x.q)
  const approxTokens = Math.round([...docTexts, ...queries].reduce((a, t) => a + t.length, 0) / 1.5)
  console.log(`전송 대상: 공개 상품 ${docs.length}개 텍스트 + 평가 질의 ${queries.length}개 · 추정 토큰 약 ${approxTokens.toLocaleString()}${DRY ? ' (--dry: 실제 전송 없음)' : ''}`)

  const embed = async (texts: readonly string[]): Promise<Float32Array[]> => (DRY ? texts.map((t) => fakeEmbed(t)) : embedAll(cfg, texts))
  const docVecs = await embed(docTexts)
  const qVecs = await embed(queries)
  const qVec = new Map(queries.map((q, i) => [q, qVecs[i]]))
  const extSims = (q: string): Map<string, number> => {
    const v = qVec.get(q)
    if (!v) return new Map()
    const cos = new Map<string, number>()
    docs.forEach((d, i) => cos.set(d.id, dot(v, docVecs[i])))
    return normalizeSims(cos)
  }

  // 자체 의미 모델(B) — 환경변수가 있을 때만(말뭉치는 허용 소스 7종, 상품은 프로덕션 공개 상품으로 교체)
  const url = process.env.PUBLIC_SUPABASE_URL
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY
  let bSims: ((q: string) => Map<string, number>) | null = null
  if (url && svc) {
    const input = await loadSemanticCorpusInput(createClient(url, svc))
    const model = buildSemanticModel(buildSemanticCorpus({ ...input, products: prodRows }).docs)
    const bVecs = buildDocVectors(model, docs.map((d) => ({ id: d.id, text: semanticDocText(d) })))
    bSims = (q) => semanticSimilarities(model, q, bVecs)
  }

  const lexicalOf = (q: string): EvalHit[] => index.search(q, { fuzzy: 0.2, prefix: true, limit: 300 }).map((r) => ({ id: r.document.id, score: r.score }))
  const searchWith = (simsOf: ((q: string) => Map<string, number>) | null, w: number) => ({
    top: (q: string): EvalHit[] => blendScores(lexicalOf(q), simsOf && w > 0 ? simsOf(q) : new Map(), w).slice(0, 30),
    wide: (q: string): EvalHit[] => blendScores(lexicalOf(q), simsOf && w > 0 ? simsOf(q) : new Map(), w),
  })

  type Row = { name: string; w: number; rank: ReturnType<typeof evaluateRanking>; guard: ReturnType<typeof evaluate> }
  const rows: Row[] = []
  const run = (name: string, simsOf: ((q: string) => Map<string, number>) | null, ws: number[]): void => {
    for (const w of ws) {
      const s = searchWith(simsOf, w)
      rows.push({ name, w, rank: evaluateRanking(docs, s.top), guard: evaluate(docs, s.top, s.wide) })
    }
  }
  run('글자만', null, [0])
  if (bSims) run('자체(B)', bSims, WEIGHTS)
  run('외부', extSims, WEIGHTS)
  if (bSims) run('자체+외부', (q) => averageSims(bSims!(q), extSims(q)), WEIGHTS)

  const base = rows[0]
  const f = (n: number): string => n.toFixed(3)
  const lines: string[] = []
  lines.push('# 외부 임베딩 비교 리포트 (D-1)', '')
  lines.push(`> 생성 ${new Date().toISOString()} · ${DRY ? '⚠️ --dry(가짜 임베딩) — 파이프라인 점검용이며 품질 판단에 쓰지 말 것' : `제공자 모델 ${cfg.model}(${new URL(cfg.baseUrl).host})`} · 평가 상품 ${docs.length}개 · 채점 질의 ${base.rank.overall.n}개`, '')
  lines.push('전송 범위: 공개 상품 텍스트 + 평가 질의(합성). 후기·글·댓글·채팅·검색 로그·회원 정보 전송 없음.', '')
  lines.push('| 구성 | weight | recall@12 | MRR | nDCG@12 | 0건 | 모델1위 | 직접3 | 분류3 | 오타·띄어쓰기 nDCG |', '|---|---|---|---|---|---|---|---|---|---|')
  for (const r of rows) {
    const o = r.rank.overall
    lines.push(`| ${r.name} | ${r.w} | ${f(o.recallAtK)} | ${f(o.mrr)} | ${f(o.ndcgAtK)} | ${(o.zeroRate * 100).toFixed(1)}% | ${r.guard.modelTop1.ok}/${r.guard.modelTop1.total} | ${r.guard.directTop3.ok}/${r.guard.directTop3.total} | ${r.guard.categoryTop3.ok}/${r.guard.categoryTop3.total} | ${f(r.rank.byGroup['오타·띄어쓰기']?.ndcgAtK ?? 0)} |`)
  }
  const ok = rows.slice(1).filter((r) => r.guard.modelTop1.ok >= base.guard.modelTop1.ok && r.guard.directTop3.ok >= base.guard.directTop3.ok && r.guard.categoryTop3.ok >= base.guard.categoryTop3.ok && r.rank.overall.zeroRate <= base.rank.overall.zeroRate)
  const best = ok.reduce<Row | null>((a, r) => (!a || r.rank.overall.ndcgAtK > a.rank.overall.ndcgAtK ? r : a), null)
  lines.push('', '## 판정(자동, 가드 통과 + 0건 비율 비증가 중 nDCG 최고)')
  lines.push(best && best.rank.overall.ndcgAtK > base.rank.overall.ndcgAtK + 0.003 ? `- ${best.name} weight ${best.w}: nDCG@12 ${f(base.rank.overall.ndcgAtK)} → ${f(best.rank.overall.ndcgAtK)}` : '- 글자만 대비 뚜렷한 이득 없음')
  const bBest = ok.filter((r) => r.name === '자체(B)').reduce<Row | null>((a, r) => (!a || r.rank.overall.ndcgAtK > a.rank.overall.ndcgAtK ? r : a), null)
  if (bBest && best && best.name !== '자체(B)') lines.push(`- 참고: 자체(B) 최고는 weight ${bBest.w}, nDCG@12 ${f(bBest.rank.overall.ndcgAtK)} → 외부 도입의 추가 이득 = ${(best.rank.overall.ndcgAtK - bBest.rank.overall.ndcgAtK).toFixed(3)}`)
  lines.push('', '운영 도입(pgvector·실시간 외부 호출)은 이 리포트 범위가 아니며 별도 계획·승인 대상입니다.')
  const report = lines.join('\n')
  console.log('\n' + report)
  const out = arg('out')
  if (out) writeFileSync(out, report + '\n')
}
main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1) })
