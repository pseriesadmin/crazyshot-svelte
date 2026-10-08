/**
 * productSearchEvalLive.test.ts — 상품 검색 인덱스 개선 전·후 실데이터 비교 (수동 실행, 읽기 전용)
 *
 * 기본 CI에서는 건너뛴다. 실행: NLSEARCH_EVAL_LIVE=1 NLSEARCH_EVAL_ANON=<프로덕션 anon 키> npx vitest run <이 파일> --disableConsoleIntercept
 *  · 프로덕션 공개(anon RLS) 상품·분류 이름을 REST로 읽기만 한다(쓰기 없음, 개인정보 없음). 키는 환경변수로만 받는다(저장소에 두지 않음).
 *  · 후기·학습 키워드·관리자 확인·동의어는 제외한 근사다(진단과 같은 한계). 지표 정의는 helpers/searchEval.ts.
 *  · "개선 전" = 분류 이름 맵이 비고 끝말 분해를 쓰지 않는 인덱스(기존과 같은 문서), "개선 후" = 현재 코드.
 * 판정: 개선 후 지표가 기준을 넘고 회귀 지표(직접 질의·모델명)가 개선 전보다 나빠지지 않아야 한다.
 */
import { describe, it, expect } from 'vitest'
import { createIndex } from '$lib/server/searchEngine/core/createIndex'
import {
  PRODUCT_INDEX_CONFIG,
  buildCategoryLabelMap,
  buildProductDocs,
  createCategoryIntentSearch,
  type ProductDoc,
} from '$lib/server/searchEngine/adapters/productSearchDocs'
import { buildRecommendSearchTerms, extractRecommendQuery } from '$lib/server/crazychat/recommend'
import { evaluate, formatSummary, type EvalHit } from '../../helpers/searchEval'

const LIVE = process.env.NLSEARCH_EVAL_LIVE === '1'
const KEY = process.env.NLSEARCH_EVAL_ANON ?? ''
const BASE = 'https://vnbpmvxruyciuuaermyh.supabase.co/rest/v1'

async function get(path: string): Promise<Record<string, unknown>[]> {
  const r = await fetch(`${BASE}/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return (await r.json()) as Record<string, unknown>[]
}

describe.skipIf(!LIVE || !KEY)('상품 검색 인덱스 — 실데이터 전·후 비교(프로덕션 읽기 전용)', () => {
  it('분류 질의 상위3 적합·재현율이 좋아지고 회귀 지표는 유지된다', async () => {
    const rows = await get(
      'products?select=id,name,brand,category,slug,product_caption,keywords,content_blocks,components,specifications&parent_product_id=is.null&is_active=eq.true&option_only=eq.false&deleted_at=is.null&limit=1000',
    )
    let labels = new Map<string, string[]>()
    let labelSource = 'code_mapping_groups(anon 읽기)'
    try {
      labels = buildCategoryLabelMap(await get('code_mapping_groups?select=name,default_category&default_category=not.is.null'))
    } catch {
      /* 아래 폴백 */
    }
    if (labels.size === 0) {
      // anon이 분류 이름을 못 읽는 환경 — 2026-10-08 M-0에서 확인한 실서버 이름으로 대체(평가 전용)
      labelSource = 'M-0 확인값(폴백)'
      labels = new Map([
        ['camera', ['카메라']], ['lens', ['렌즈']], ['actcam', ['액션캠']], ['dronegim', ['드론/짐벌']],
        ['light', ['조명']], ['accessorie', ['악세서리']], ['hypepack', ['추천패키지']],
      ])
    }

    const buildSide = (categoryLabels: ReadonlyMap<string, string[]>) => {
      const t0 = Date.now()
      const docs = buildProductDocs(rows, { categoryLabels })
      const index = createIndex<ProductDoc>(PRODUCT_INDEX_CONFIG, docs)
      const ms = Date.now() - t0
      const intent = createCategoryIntentSearch(index, categoryLabels)
      const rec = (m: string): EvalHit[] => {
        const { query, tokens } = extractRecommendQuery(m)
        const q = query || m
        const merged = new Map<string, number>()
        const add = (t: string, w: number): void => {
          for (const r of intent(t, { fuzzy: 0.2, prefix: true, limit: 30 })) merged.set(r.document.id, Math.max(merged.get(r.document.id) ?? 0, r.score * w))
        }
        for (const t of buildRecommendSearchTerms(q, query ? tokens : q.split(/\s+/), [])) add(t.q, t.weight)
        return [...merged.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score).slice(0, 15)
      }
      const wide = (q: string): EvalHit[] => index.search(q, { fuzzy: 0.2, prefix: true, limit: 300 }).map((r) => ({ id: r.document.id, score: r.score }))
      return { docs, ms, report: evaluate(docs, rec, wide) }
    }

    const before = buildSide(new Map())
    const after = buildSide(labels)

    process.stdout.write(
      [
        `상품 ${after.docs.length}개 · 분류 이름 출처: ${labelSource}`,
        `\n■ 개선 전 (분류 이름 없음 — 기존과 같은 문서; 끝말 칸은 포함되어 있어 완전한 '전'은 M-0 기록값 참고)\n${formatSummary(before.report)}`,
        `\n■ 개선 후\n${formatSummary(after.report)}`,
        `\n빌드 시간(문서 변환+인덱스 구축): 전 ${before.ms}ms · 후 ${after.ms}ms`,
        `\n${after.report.lines.join('\n')}`,
      ].join('\n') + '\n',
    )

    const r = after.report
    expect(r.recall.camera.found).toBe(r.recall.camera.total)
    expect(r.recall.lens.found).toBe(r.recall.lens.total)
    expect(r.categoryTop3.ok).toBeGreaterThan(before.report.categoryTop3.ok)
    expect(r.directTop3.ok).toBeGreaterThanOrEqual(before.report.directTop3.ok)
    expect(r.modelTop1.ok).toBe(r.modelTop1.total)
  }, 60_000)
})
