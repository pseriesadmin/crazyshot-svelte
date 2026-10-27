/**
 * TDD: searchProductsExtraTermsDb.test.ts — Migration #773 (Stage 전용 라이브)
 * 대상: public.search_products 의 7번째 선택 인자 p_extra_terms(동의어 변환어)와 공백·하이픈 무시 매칭
 * 확인: ① p_extra_terms 로 넘긴 변환어로만 맞는 상품이 결과에 들어온다(없으면 안 들어온다)
 *       ② 검색어의 공백·하이픈 유무가 상품명과 달라도 찾는다(r6markii ↔ "R6 Mark II", AGCX10 ↔ "AG-CX10")
 *       ③ 3자 미만 검색어는 공백 무시 매칭을 하지 않는다 ④ 기존 6인자 호출(p_extra_terms 생략)이 그대로 동작
 *       ⑤ 검색 로그에는 원래 검색어만 기록되고 변환어는 기록되지 않는다 ⑥ 2페이지의 total_count 가 1페이지와 같다
 *       ⑦ 빈 배열·NULL·빈 문자열 원소가 오류 없이 무시된다
 * 자체 fixture([TDD-XTRA] 접두)를 만들고 정리한다. 이 테스트가 만든 search_logs 행은 응답의 search_log_id 와 고유 질의 문자열로만 지운다.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

const isStage = PUBLIC_SUPABASE_URL.includes('ezyvffjvuwmtuhpxdjrw')
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const rnd = (): string => Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 6).padEnd(6, 'q')
const productIds: string[] = []
const logIds = new Set<string>()
const usedQueries = new Set<string>()

interface Row { product_id: string; total_count: number; search_log_id: string | null }

async function makeProduct(name: string): Promise<string> {
  const { data, error } = await admin
    .from('products')
    .insert({ name, category: 'accessory', keywords: [], is_active: true } as never)
    .select('id')
    .single()
  if (error || !data) throw new Error(`fixture 실패: ${error?.message}`)
  const id = (data as { id: string }).id
  productIds.push(id)
  return id
}

async function search(query: string, extra: Record<string, unknown> = {}): Promise<Row[]> {
  usedQueries.add(query)
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
  // 0건 응답은 search_log_id 가 반환되지 않으므로 이 테스트의 고유 질의 문자열로만 정리(최근 5분)
  if (usedQueries.size) await admin.from('search_logs').delete().in('query', [...usedQueries]).gte('created_at', new Date(Date.now() - 5 * 60_000).toISOString())
})

// 긴 설명 단어를 붙여 이름 유사도(trigram)만으로 매칭되는 일을 막는다
const FILLER = 'wireless gimbal stabilizer handheld portable travel kit accessory bundle'

describe.skipIf(!isStage)('search_products — p_extra_terms·공백 무시 (Stage, Migration #773)', () => {
  it('① 변환어(p_extra_terms)로만 맞는 상품은 넘겼을 때만 결과에 들어온다', async () => {
    const en = `en${rnd()}`
    const ko = `ko${rnd()}` // 상품 어디에도 없는 질의어
    const id = await makeProduct(`[TDD-XTRA] ${en} ${FILLER}`)
    const plain = await search(ko)
    expect(plain.map((r) => r.product_id)).not.toContain(id)
    const withExtra = await search(ko, { p_extra_terms: [en] })
    expect(withExtra.map((r) => r.product_id)).toContain(id)
  })

  it('② 공백·하이픈 유무가 달라도 찾는다 (붙여 쓴 질의 → 띄어 쓴 이름, 하이픈 없는 질의 → 하이픈 이름)', async () => {
    const a = rnd(); const b = rnd()
    const spaced = await makeProduct(`[TDD-XTRA] ${a} ${b} II ${FILLER}`)
    const hyphen = await makeProduct(`[TDD-XTRA] ${a}-${b} ${FILLER}`)
    const r1 = await search(`${a}${b}ii`)
    expect(r1.map((r) => r.product_id)).toContain(spaced)
    const r2 = await search(`${a}${b}`)
    expect(r2.map((r) => r.product_id)).toContain(hyphen)
    const r3 = await search(`${a} ${b}`) // 띄어 쓴 질의 → 하이픈·붙임 표기도 찾는다
    expect(r3.map((r) => r.product_id)).toContain(hyphen)
  })

  it('③ 정규화한 검색어가 3자 미만이면 공백 무시 매칭을 하지 않는다', async () => {
    // 이름에 붙여 쓴 'ab'가 있어도(단어 'a'·'b'가 따로 없어 일반 검색은 맞추지 못한다) 정규화 'ab'(2자) 질의는 공백 무시 매칭을 하지 않는다
    const x = rnd()
    const id = await makeProduct(`[TDD-XTRA] ${x}ab ${FILLER}`)
    const rows = await search('a b')
    expect(rows.map((r) => r.product_id)).not.toContain(id)
    // 대조: 정규화 3자 이상이면 같은 방식의 상품이 찾아진다
    const id3 = await makeProduct(`[TDD-XTRA] ${x}abc ${FILLER}`)
    const rows3 = await search('abc'.split('').join(' ') + '') // 'a b c' → 정규화 'abc'
    expect(rows3.map((r) => r.product_id)).toContain(id3)
  })

  it('④ 기존 6인자 호출(p_extra_terms 생략)과 NULL·빈 배열·빈 원소는 오류 없이 동작한다', async () => {
    const q = `q${rnd()}`
    await expect(search(q)).resolves.toBeDefined()
    await expect(search(q, { p_extra_terms: null })).resolves.toBeDefined()
    await expect(search(q, { p_extra_terms: [] })).resolves.toBeDefined()
    await expect(search(q, { p_extra_terms: ['', '  ', null] })).resolves.toBeDefined()
  })

  it('⑤ 검색 로그에는 원래 검색어만 기록되고 변환어는 기록되지 않는다', async () => {
    const en = `en${rnd()}`
    const ko = `ko${rnd()}`
    await makeProduct(`[TDD-XTRA] ${en} ${FILLER}`)
    const rows = await search(ko, { p_extra_terms: [en] })
    expect(rows.length).toBeGreaterThan(0)
    const logId = rows[0].search_log_id
    expect(logId).toBeTruthy()
    const { data } = await admin.from('search_logs').select('query').eq('id', logId as string).single()
    expect((data as { query: string }).query).toBe(ko)
    const { data: leaked } = await admin.from('search_logs').select('id').eq('query', en)
    expect(leaked ?? []).toHaveLength(0)
  })

  it('⑥ 2페이지의 total_count 가 1페이지와 같다(원래 검색어 기준 페이지 유지)', async () => {
    const en = `en${rnd()}`
    const ko = `ko${rnd()}`
    for (let i = 0; i < 3; i++) await makeProduct(`[TDD-XTRA] ${en} item${i} ${FILLER}`)
    usedQueries.add(ko)
    const p1 = await admin.rpc('search_products', { p_query: ko, p_page: 1, p_limit: 2, p_extra_terms: [en] })
    const p2 = await admin.rpc('search_products', { p_query: ko, p_page: 2, p_limit: 2, p_extra_terms: [en] })
    const r1 = (p1.data ?? []) as Row[]
    const r2 = (p2.data ?? []) as Row[]
    for (const r of [...r1, ...r2]) if (r.search_log_id) logIds.add(r.search_log_id)
    expect(r1).toHaveLength(2)
    expect(r2).toHaveLength(1)
    expect(r1[0].total_count).toBe(3)
    expect(r2[0].total_count).toBe(3)
  })
})
