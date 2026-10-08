/**
 * TDD: searchProductsCategoryIntentDb.test.ts — Migration #683 (Stage 전용 라이브)
 * 대상: public.search_category_intent(질의 → 분류 코드 목록) + public.search_products(분류 의도 + 한글 초성 검색 복원)
 * 확인: ① SQL 판정이 TS detectCategoryIntent와 같은 표에서 같은 결과(이중 관리 어긋남 방지) ② 보조 함수는 service_role 전용
 *       ③ 질의 끝이 분류 이름이면 해당 분류 상품이 결과에 포함되고 앞 구간 ④ 분류 이름이 아닌 끝말("카메라 가방")·카테고리 탭 불일치는 의도 없음
 *       ⑤ 호출당 검색 로그 1행 + result_count가 본문 매칭 수와 일치 ⑥ 자음만으로 된 질의는 초성 검색(상품명·브랜드), 자음+다른 글자 혼합은 초성 검색 아님
 * 자체 fixture([TDD-SRCH] 접두)를 만들고 정리한다. 이 테스트가 만든 search_logs 행은 고유 질의 문자열 또는 응답의 search_log_id로만 지운다.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public'
import { buildCategoryLabelMap, detectCategoryIntent } from '$lib/server/searchEngine/adapters/productSearchDocs'
import { CATEGORY_QUERIES, DIRECT_QUERIES, FREE_QUERIES, MODEL_QUERIES } from '../helpers/searchEval'

const isStage = PUBLIC_SUPABASE_URL.includes('ezyvffjvuwmtuhpxdjrw')
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
const tag = `s${Date.now().toString(36)}` // 질의 전용 고유 문자열
// 상품 이름에는 질의와 겹치지 않는 별도 문자열을 쓴다 — 같은 문자열이 이름과 질의에 있으면 이름 유사도(similarity)만으로 매칭돼 분류 의도 검증이 오염된다
const nameTag = `n${Math.random().toString(36).slice(2, 8)}`
const productIds: string[] = []
const logIds = new Set<string>()
const usedQueries = new Set<string>()

interface Row { product_id: string; category: string; rank_score: number; total_count: number; search_log_id: string | null }

async function makeProduct(fields: { name: string; category: string; brand?: string; keywords?: string[] }): Promise<string> {
  const { data, error } = await admin
    .from('products')
    .insert({ name: fields.name, category: fields.category, brand: fields.brand ?? null, keywords: fields.keywords ?? [], is_active: true } as never)
    .select('id')
    .single()
  if (error || !data) throw new Error(`fixture 실패: ${error?.message}`)
  const id = (data as { id: string }).id
  productIds.push(id)
  return id
}

async function search(query: string | null, extra: Record<string, unknown> = {}): Promise<Row[]> {
  if (query) usedQueries.add(query)
  const { data, error } = await admin.rpc('search_products', { p_query: query, p_limit: 50, ...extra })
  if (error) throw new Error(`search_products 실패(${query}): ${error.message}`)
  const rows = (data ?? []) as Row[]
  for (const r of rows) if (r.search_log_id) logIds.add(r.search_log_id)
  return rows
}

afterAll(async () => {
  if (!isStage) return
  for (const id of productIds) await admin.from('products').delete().eq('id', id)
  if (logIds.size) await admin.from('search_logs').delete().in('id', [...logIds])
  // 0건 응답은 search_log_id가 반환되지 않으므로 이 테스트의 고유 질의 문자열로만 정리
  // 고정 질의(자음 전용 'ㅋㅋㅋㅋ'·'ㅋㅋㅋㅋ mx')는 다른 세션의 같은 질의 로그와 겹칠 수 있어 이 테스트 실행 시간대(최근 5분)만 지운다
  const unique = [...usedQueries].filter((q) => q.includes(tag) || q === 'ㅋㅋㅋㅋ' || q === 'ㅋㅋㅋㅋ mx')
  if (unique.length) await admin.from('search_logs').delete().in('query', unique).gte('created_at', new Date(Date.now() - 5 * 60_000).toISOString())
})

describe.skipIf(!isStage)('search_category_intent — SQL 판정 (Stage)', () => {
  it('같은 질의 표에서 TS detectCategoryIntent와 결과가 같다(이중 관리 어긋남 방지)', async () => {
    const { data: groups, error } = await admin.from('code_mapping_groups').select('name, default_category, is_active').eq('is_active', true)
    expect(error).toBeNull()
    const labels = buildCategoryLabelMap(groups)
    const queries = [
      ...CATEGORY_QUERIES.map((c) => c.q), ...DIRECT_QUERIES.map((c) => c.q), ...MODEL_QUERIES.map((c) => c.q), ...FREE_QUERIES,
      '카메라를', '카메라?', '카메라??', '카메라 렌즈 줘요', '카메라 알려줘', '소니카메라', '카메라/렌즈', 'Camera', '렌즈를', '카메라,렌즈',
      '중고품', '쿠폰 코드', '분류', '개인', '회원', '구독을', '추천', '렌즈 추천해주세요!', '카메라 ㅋ', '  카메라  ', '카메라 도', '카메라까지',
    ]
    const mismatches: string[] = []
    for (const q of queries) {
      const expected = detectCategoryIntent(q, labels)?.slice().sort() ?? null
      const { data, error: e } = await admin.rpc('search_category_intent', { p_query: q })
      expect(e, q).toBeNull()
      const actual = Array.isArray(data) ? (data as string[]).slice().sort() : null
      if (JSON.stringify(actual) !== JSON.stringify(expected)) mismatches.push(`"${q}" TS=${JSON.stringify(expected)} SQL=${JSON.stringify(actual)}`)
    }
    expect(mismatches).toEqual([])
  })
  it('질의가 NULL이거나 빈 값이면 NULL', async () => {
    for (const q of [null, '', '   ']) {
      const { data, error } = await admin.rpc('search_category_intent', { p_query: q })
      expect(error).toBeNull()
      expect(data).toBeNull()
    }
  })
  it('서버 전용: anon 호출은 권한 오류, service_role은 성공', async () => {
    const denied = await anon.rpc('search_category_intent', { p_query: '카메라' })
    expect(denied.error).not.toBeNull()
    const ok = await admin.rpc('search_category_intent', { p_query: '카메라' })
    expect(ok.error).toBeNull()
  })
  it('authenticated(익명 로그인 세션)도 거부되고, 공개 검색 함수 search_products는 anon으로 호출된다', async () => {
    const c = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    const { data: sess, error: signErr } = await c.auth.signInAnonymously()
    if (signErr) return // 익명 로그인이 꺼진 환경이면 건너뜀(anon 거부는 위 테스트가 보장)
    const anonUserId = sess.user?.id
    try {
      const denied = await c.rpc('search_category_intent', { p_query: '카메라' })
      expect(denied.error).not.toBeNull()
      const pub = await c.rpc('search_products', { p_query: null, p_limit: 3 })
      expect(pub.error).toBeNull() // 전체 목록(질의 NULL)은 로그를 남기지 않는 공개 경로
    } finally {
      // 실행마다 Stage auth.users에 익명 사용자가 쌓이지 않도록 이 테스트가 만든 사용자만 삭제
      if (anonUserId) await admin.auth.admin.deleteUser(anonUserId)
    }
  })
})

describe.skipIf(!isStage)('search_products — 분류 의도 (Stage)', () => {
  it('질의 끝이 분류 이름이면 해당 분류 상품이 텍스트 일치가 없어도 포함되고 앞 구간에 온다', async () => {
    const cam = await makeProduct({ name: `[TDD-SRCH] cam ${nameTag}`, category: 'camera' })
    const lens = await makeProduct({ name: `[TDD-SRCH] lens ${nameTag}`, category: 'lens' })
    const acc = await makeProduct({ name: `[TDD-SRCH] acc ${nameTag}`, category: 'accessory', keywords: [`${tag}x`, '카메라'] })
    const rows = await search(`${tag}x 카메라`)
    const ids = rows.map((r) => r.product_id)
    expect(ids).toContain(cam) // 분류 의도로만 들어옴(텍스트 일치 없음)
    expect(ids).toContain(acc) // 텍스트 일치
    expect(ids).not.toContain(lens)
    // 카메라 분류가 전부 비카메라보다 앞
    const firstNonCam = rows.findIndex((r) => r.category !== 'camera')
    const lastCam = rows.map((r) => r.category).lastIndexOf('camera')
    expect(firstNonCam === -1 || firstNonCam > lastCam).toBe(true)
  })
  it('두 분류로 끝나면("… 카메라 렌즈") 둘 다 포함', async () => {
    const cam = await makeProduct({ name: `[TDD-SRCH] cam2 ${nameTag}`, category: 'camera' })
    const lens = await makeProduct({ name: `[TDD-SRCH] lens2 ${nameTag}`, category: 'lens' })
    const ids = (await search(`${tag}y 카메라 렌즈`)).map((r) => r.product_id)
    expect(ids).toContain(cam)
    expect(ids).toContain(lens)
  })
  it('끝말이 분류 이름이 아니면("… 카메라 가방") 의도 없음 — 분류 상품이 끼지 않는다', async () => {
    const cam = await makeProduct({ name: `[TDD-SRCH] cam3 ${nameTag}`, category: 'camera' })
    const ids = (await search(`${tag}z 카메라 가방`)).map((r) => r.product_id)
    expect(ids).not.toContain(cam)
  })
  it('카테고리 탭 필터와 의도가 겹치지 않으면 의도 상품도 제외(필터가 우선)', async () => {
    const cam = await makeProduct({ name: `[TDD-SRCH] cam4 ${nameTag}`, category: 'camera' })
    const ids = (await search(`${tag}w 카메라`, { p_category: 'lens' })).map((r) => r.product_id)
    expect(ids).not.toContain(cam)
  })
  it('호출당 검색 로그 1행, result_count가 본문 총건수와 일치', async () => {
    await makeProduct({ name: `[TDD-SRCH] cam5 ${nameTag}`, category: 'camera' })
    const q = `${tag}v 카메라`
    const rows = await search(q)
    expect(rows.length).toBeGreaterThan(0)
    const { data: logs } = await admin.from('search_logs').select('id, result_count').eq('query', q)
    expect(logs).toHaveLength(1)
    expect((logs as Array<{ result_count: number }>)[0].result_count).toBe(Number(rows[0].total_count))
  })
  it('페이지를 나눠 합쳐도 한 번에 가져온 결과와 순서가 같다(분류 의도 정렬이 페이지 경계에서 일관)', async () => {
    for (let i = 0; i < 4; i++) await makeProduct({ name: `[TDD-SRCH] pg${i} ${nameTag}`, category: 'camera' })
    const q = `${tag}pg 카메라`
    const whole = (await search(q, { p_limit: 12 })).map((r) => r.product_id)
    const parts: string[] = []
    for (const page of [1, 2, 3, 4]) parts.push(...(await search(q, { p_limit: 3, p_page: page })).map((r) => r.product_id))
    expect(parts).toEqual(whole)
    expect(whole.length).toBeGreaterThanOrEqual(8)
  })
  it('질의 NULL(전체 목록)은 의도·초성과 무관하게 동작하고 로그를 남기지 않는다', async () => {
    const rows = await search(null)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.search_log_id === null)).toBe(true)
  })
})

describe.skipIf(!isStage)('search_products — 한글 초성 검색 복원 (Stage)', () => {
  it('자음만 입력하면 상품명·브랜드의 초성과 일치하는 상품이 나온다', async () => {
    const byName = await makeProduct({ name: `[TDD-SRCH] 퀘퀘퀘퀘 ${nameTag}`, category: 'other' })
    const byBrand = await makeProduct({ name: `[TDD-SRCH] brandonly ${nameTag}`, category: 'other', brand: '쾌쾌쾌쾌' })
    const ids = (await search('ㅋㅋㅋㅋ')).map((r) => r.product_id)
    expect(ids).toContain(byName)
    expect(ids).toContain(byBrand)
  })
  it('자음에 다른 글자가 섞이면 초성 검색이 아니다(354 원문처럼 모든 질의에 초성을 걸면 이 질의는 일치했을 것)', async () => {
    // 이름의 초성은 "ㅋㅋㅋㅋ mx…" — 질의 "ㅋㅋㅋㅋ mx"의 초성 변환값(= 질의 그대로)이 부분일치한다. 자음 전용 제한이 없으면 포함되고, 있으면 제외된다.
    const p = await makeProduct({ name: `[TDD-SRCH] 퀘퀘퀘퀘 mx${nameTag}`, category: 'other' })
    const ids = (await search('ㅋㅋㅋㅋ mx')).map((r) => r.product_id)
    expect(ids).not.toContain(p)
  })
})
