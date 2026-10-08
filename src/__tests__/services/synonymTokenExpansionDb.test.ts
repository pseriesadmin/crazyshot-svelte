/**
 * TDD: synonymTokenExpansionDb.test.ts — 동의어 단어 단위 치환 실DB 검증 (Stage 전용, N-6)
 * 핵심: 확정 동의어로 연결된 한글 별칭 + 일반 단어("별칭 일반단어") 검색이 고객 검색 API·CMS 검색 제안 양쪽에서
 *       영문 상품을 찾고 / 변형어로 검색 RPC를 다시 부르지 않아 search_logs에 변형 문자열이 쌓이지 않으며 /
 *       동의어가 없으면 찾지 못한다.
 * 동의어 그룹은 테스트가 만든 합성 데이터를 주입(loadSynonymGroups 모킹)하고, 상품·인덱스·검색 RPC·로그는 실제 Stage를 쓴다.
 * 검색 RPC가 남기는 search_logs 행은 이 테스트가 만든 고유 검색어 것만 스스로 정리한다(기존 Stage 데이터 삭제 금지).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
// 주의(2026-10-08): 일반 단어로 "카메라" 같은 분류 이름을 쓰면 안 된다 — 분류 이름 칸(L-2) 도입 뒤 "카메라"가 카메라 분류 상품을 직접 잡아
// "동의어가 없으면 못 찾는다"는 전제가 깨진다. 일반 단어는 어떤 상품에도 없는 임의 단어(nonce)를 쓴다.
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

let mockGroups: Array<{ canonicalTerm: string; confirmedTerms: string[] }> = []
vi.mock('$lib/server/synonymLearning', () => ({ loadSynonymGroups: async () => mockGroups }))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: async () => 'manager' }))
vi.mock('$lib/server/getCmsRoleForAction.ts', () => ({ getCmsRoleForAction: async () => 'manager' }))

import { invalidateProductSearchCache } from '$lib/server/searchEngine/adapters/productSearchIndex'
import { GET as customerGET } from '../../routes/api/search/products/+server'
import { GET as cmsGET } from '../../routes/api/cms/products/search-suggestions/+server'

const isStage = PUBLIC_SUPABASE_URL.includes('ezyvffjvuwmtuhpxdjrw')
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  mockGroups = []
  while (cleanups.length) await cleanups.pop()?.().catch(() => undefined)
})
const rand = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** 활성 부모 대여 상품 중 이름에 영문 단어(4자 이상)가 있는 것 하나 */
async function pickLatinProduct(): Promise<{ id: string; latin: string }> {
  const { data, error } = await admin
    .from('products').select('id, name')
    .is('parent_product_id', null).is('deleted_at', null)
    .eq('is_active', true).eq('sale_only', false).eq('option_only', false)
    .order('created_at', { ascending: true }).limit(80)
  if (error || !data) throw new Error(`상품 조회 실패: ${error?.message}`)
  for (const p of data as Array<{ id: string; name: string }>) {
    const word = p.name.split(/[\s\-_/]+/).find((w) => /^[A-Za-z]{4,}$/.test(w))
    if (word) return { id: p.id, latin: word.toLowerCase() }
  }
  throw new Error('이름에 영문 단어가 있는 Stage 대여 상품이 없습니다')
}

async function customerSearch(q: string): Promise<string[]> {
  invalidateProductSearchCache()
  const url = new URL(`https://example.com/api/search/products?q=${encodeURIComponent(q)}&limit=50`)
  const locals = { safeGetSession: async () => ({ session: null }), supabase: anon }
  const res = (await customerGET({ url, locals } as unknown as Parameters<typeof customerGET>[0])) as Response
  const body = (await res.json()) as { results: Array<Record<string, unknown>> }
  return body.results.map((r) => String(r['product_id'] ?? r['id']))
}

async function cmsSearch(q: string): Promise<string[]> {
  invalidateProductSearchCache()
  const url = new URL(`https://example.com/api/cms/products/search-suggestions?q=${encodeURIComponent(q)}&limit=20`)
  const res = (await cmsGET({ url, locals: {} } as unknown as Parameters<typeof cmsGET>[0])) as Response
  const body = (await res.json()) as Array<{ id: string }>
  return body.map((r) => r.id)
}

async function logRowsFor(query: string): Promise<number> {
  const { count } = await admin.from('search_logs').select('id', { count: 'exact', head: true }).eq('query', query)
  return count ?? 0
}

describe.skipIf(!isStage)('동의어 단어 단위 치환 — 실DB (고객 검색 API · CMS 검색 제안)', () => {
  it('고객 검색 API: "별칭 + 일반 단어"가 영문 상품을 찾고, 변형어는 검색 로그에 쌓이지 않는다', async () => {
    const p = await pickLatinProduct()
    const alias = `큐에이별칭${rand()}`
    const generic = `일반${rand()}`
    const q = `${alias} ${generic}`
    const variant = `${p.latin} ${generic}`
    mockGroups = [{ canonicalTerm: alias, confirmedTerms: [alias, p.latin] }]
    cleanups.push(async () => { await admin.from('search_logs').delete().in('query', [q, variant]) })
    const before = await logRowsFor(variant)

    const found = await customerSearch(q)
    expect(found).toContain(p.id)
    // 로그 오염 없음: 변형 문자열로는 검색 RPC가 불리지 않아 search_logs에 행이 늘지 않는다
    expect(await logRowsFor(variant)).toBe(before)

    // 동의어가 없으면 같은 질의로 찾지 못한다(= 위 결과는 변형 덕분)
    mockGroups = []
    expect(await customerSearch(q)).not.toContain(p.id)
  })

  it('CMS 검색 제안: "별칭 + 일반 단어"가 영문 상품을 찾는다(동의어 없으면 못 찾음)', async () => {
    const p = await pickLatinProduct()
    const alias = `큐에이별칭${rand()}`
    const q = `${alias} 일반${rand()}`
    mockGroups = [{ canonicalTerm: alias, confirmedTerms: [alias, p.latin] }]
    expect(await cmsSearch(q)).toContain(p.id)

    mockGroups = []
    expect(await cmsSearch(q)).not.toContain(p.id)
  })

  it('검색어 전체가 동의어인 기존 경로도 그대로 동작한다(고객 검색 API)', async () => {
    const p = await pickLatinProduct()
    const alias = `큐에이별칭${rand()}`
    mockGroups = [{ canonicalTerm: alias, confirmedTerms: [alias, p.latin] }]
    cleanups.push(async () => { await admin.from('search_logs').delete().in('query', [alias, p.latin]).gte('created_at', new Date(Date.now() - 120_000).toISOString()) })
    expect(await customerSearch(alias)).toContain(p.id)
  })
})
