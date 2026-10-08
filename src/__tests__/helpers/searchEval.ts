/**
 * searchEval.ts — 상품 검색 인덱스 전·후 비교용 평가 도구 (순수 함수, DB·$env 없음)
 * 용도: productSearchEvalLive.test.ts(실데이터 수동 실행)가 질의 세트를 돌려 지표를 출력한다.
 * 지표 정의는 개선 전·후가 동일해야 비교가 의미 있다 — 정의를 바꾸면 전(前) 기준값도 다시 측정할 것.
 */

export interface EvalDoc { id: string; name: string; category: string }
export interface EvalHit { id: string; score: number }
/** 질의(또는 고객 문장)를 받아 점수순 결과를 돌려준다. 문장이면 호출 측에서 검색어 추출을 포함한다. */
export type EvalSearch = (query: string) => EvalHit[]

export interface CategoryQuery { q: string; expectCats: string[] }
export interface ModelQuery { q: string; nameRe: RegExp }

/** 분류가 분명한 질의 — 상위 3개가 기대 분류인지 본다 */
export const CATEGORY_QUERIES: readonly CategoryQuery[] = [
  { q: '카메라', expectCats: ['camera'] },
  { q: '렌즈', expectCats: ['lens'] },
  { q: '카메라 렌즈', expectCats: ['camera', 'lens'] },
  { q: '카메라, 렌즈 추천해 주세요', expectCats: ['camera', 'lens'] },
  { q: '카메라 추천해줘', expectCats: ['camera'] },
  { q: '렌즈 추천해줘', expectCats: ['lens'] },
  { q: '소니 카메라', expectCats: ['camera'] },
  { q: '캐논 렌즈', expectCats: ['lens'] },
  { q: '소니 렌즈', expectCats: ['lens'] },
  { q: '브이로그 카메라', expectCats: ['camera'] },
  { q: '인터뷰 카메라', expectCats: ['camera'] },
  { q: '풀프레임 카메라', expectCats: ['camera'] },
  { q: '캠코더', expectCats: ['camera'] },
  { q: '광각 렌즈', expectCats: ['lens'] },
  { q: '망원 렌즈', expectCats: ['lens'] },
  { q: '단렌즈', expectCats: ['lens'] },
  { q: '무대를 최대한 당겨 찍을 수 있는 선명도 높은 카메라 렌즈를 추천해 줘요.', expectCats: ['camera', 'lens'] },
]

/** 액세서리 등 직접 질의 — 개선 후에도 해당 분류가 상위 3개에 유지돼야 한다(회귀 지표) */
export const DIRECT_QUERIES: readonly CategoryQuery[] = [
  { q: '삼각대', expectCats: ['accessorie', 'actcam'] },
  { q: '짐벌', expectCats: ['dronegim', 'hypepack'] },
  { q: '조명', expectCats: ['light'] },
  { q: '드론', expectCats: ['dronegim'] },
  { q: '액션캠', expectCats: ['actcam', 'hypepack'] },
  { q: '마이크', expectCats: ['accessorie'] },
  { q: '배터리', expectCats: ['accessorie'] },
  { q: '모니터', expectCats: ['accessorie'] },
  { q: '슬라이더', expectCats: ['accessorie'] },
]

/** 모델명·브랜드 정확 질의 — 1위가 그 상품이어야 한다(회귀 지표) */
export const MODEL_QUERIES: readonly ModelQuery[] = [
  { q: 'Sony A7S3', nameRe: /^Sony A7S3$/ },
  { q: 'Canon 5D Mark IV', nameRe: /^Canon 5D Mark IV$/ },
  { q: 'Insta360 GO3', nameRe: /^Insta360 GO3$/ },
  { q: 'Aputure 600C PRO II', nameRe: /^Aputure 600C PRO II$/ },
]

/** 참고용(기대 없음) — 순위만 출력 */
export const FREE_QUERIES: readonly string[] = ['미러리스', '카메라 가방']

export interface EvalReport {
  /** "카메라"/"렌즈" 단독 검색에서 해당 분류 상품이 몇 개나 잡혔나 */
  recall: { camera: { found: number; total: number }; lens: { found: number; total: number } }
  /** 분류 질의 상위3 적합: 상위 3개가 전부 기대 분류인 질의 수 / 전체 */
  categoryTop3: { ok: number; total: number; failed: string[] }
  categoryTop1: { ok: number; total: number }
  directTop3: { ok: number; total: number; failed: string[] }
  modelTop1: { ok: number; total: number; failed: string[] }
  maxScore: number
  lines: string[]
}

export function evaluate(docs: readonly EvalDoc[], search: EvalSearch, searchWide: EvalSearch): EvalReport {
  const byId = new Map(docs.map((d) => [d.id, d]))
  const catOf = (id: string): string => byId.get(id)?.category ?? '?'
  const nameOf = (id: string): string => byId.get(id)?.name ?? '?'
  const lines: string[] = []

  const total = (c: string): number => docs.filter((d) => d.category === c).length
  const found = (q: string, c: string): number => searchWide(q).filter((h) => catOf(h.id) === c).length
  const recall = {
    camera: { found: found('카메라', 'camera'), total: total('camera') },
    lens: { found: found('렌즈', 'lens'), total: total('lens') },
  }

  let maxScore = 0
  const runCats = (items: readonly CategoryQuery[], label: string): { ok: number; top1: number; failed: string[] } => {
    let ok = 0
    let top1 = 0
    const failed: string[] = []
    lines.push(`\n[${label}]`)
    for (const it of items) {
      const hits = search(it.q)
      if (hits[0]) maxScore = Math.max(maxScore, hits[0].score)
      const top3 = hits.slice(0, 3)
      const pass = top3.length > 0 && top3.every((h) => it.expectCats.includes(catOf(h.id)))
      if (pass) ok++
      else failed.push(it.q)
      if (hits[0] && it.expectCats.includes(catOf(hits[0].id))) top1++
      lines.push(`  ${pass ? 'O' : 'X'} "${it.q.length > 28 ? it.q.slice(0, 28) + '…' : it.q}" 기대[${it.expectCats.join('|')}] → ${top3.map((h) => `[${catOf(h.id)}] ${nameOf(h.id)}`).join(' / ') || '(없음)'}`)
    }
    return { ok, top1, failed }
  }
  const cat = runCats(CATEGORY_QUERIES, '분류 질의 상위3')
  const direct = runCats(DIRECT_QUERIES, '직접 질의(회귀)')

  lines.push('\n[모델명 정확 질의 1위]')
  let modelOk = 0
  const modelFailed: string[] = []
  for (const it of MODEL_QUERIES) {
    const top = search(it.q)[0]
    const pass = !!top && it.nameRe.test(nameOf(top.id).trim())
    if (pass) modelOk++
    else modelFailed.push(it.q)
    lines.push(`  ${pass ? 'O' : 'X'} "${it.q}" → ${top ? nameOf(top.id) : '(없음)'}`)
  }

  lines.push('\n[참고(기대 없음)]')
  for (const q of FREE_QUERIES) lines.push(`  "${q}" → ${search(q).slice(0, 4).map((h) => `[${catOf(h.id)}] ${nameOf(h.id)}`).join(' / ') || '(없음)'}`)

  return {
    recall,
    categoryTop3: { ok: cat.ok, total: CATEGORY_QUERIES.length, failed: cat.failed },
    categoryTop1: { ok: cat.top1, total: CATEGORY_QUERIES.length },
    directTop3: { ok: direct.ok, total: DIRECT_QUERIES.length, failed: direct.failed },
    modelTop1: { ok: modelOk, total: MODEL_QUERIES.length, failed: modelFailed },
    maxScore,
    lines,
  }
}

export function formatSummary(r: EvalReport): string {
  return [
    `카메라 재현율 ${r.recall.camera.found}/${r.recall.camera.total} · 렌즈 재현율 ${r.recall.lens.found}/${r.recall.lens.total}`,
    `분류 질의 상위3 적합 ${r.categoryTop3.ok}/${r.categoryTop3.total} · 상위1 적합 ${r.categoryTop1.ok}/${r.categoryTop1.total}`,
    `직접 질의 상위3 유지 ${r.directTop3.ok}/${r.directTop3.total}${r.directTop3.failed.length ? ` (실패: ${r.directTop3.failed.join(', ')})` : ''}`,
    `모델명 1위 유지 ${r.modelTop1.ok}/${r.modelTop1.total}${r.modelTop1.failed.length ? ` (실패: ${r.modelTop1.failed.join(', ')})` : ''}`,
    `질의 1위 점수 최댓값 ${r.maxScore.toFixed(1)}`,
  ].join('\n')
}
