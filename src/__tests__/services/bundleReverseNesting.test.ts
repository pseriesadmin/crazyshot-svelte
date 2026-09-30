/**
 * bundleReverseNesting.test.ts — Migration #601 (2026-09-30, Stephen 지시)
 * 결합상품 양방향 중첩 차단: 이미 다른 패키지의 부품인 상품은 자신의 결합상품 목록을 만들 수 없다.
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트. fixture는 이 파일이 직접 만들고 afterEach에서 정리한다.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const created: string[] = []

afterEach(async () => {
  if (created.length === 0) return
  await admin.from('product_bundle_links').delete().in('product_id', created)
  await admin.from('product_bundle_links').delete().in('bundle_product_id', created)
  await admin.from('products').delete().in('id', created)
  created.length = 0
}, 60000)

async function makeProduct(label: string): Promise<string> {
  const { data, error } = await admin
    .from('products')
    .insert({ name: `[TDD-NEST] ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, category: 'other', is_active: true })
    .select('id')
    .single()
  if (error || !data) throw new Error(`상품 생성 실패: ${error?.message}`)
  created.push(data.id as string)
  return data.id as string
}

const link = (id: string) => [{ bundle_product_id: id, display_order: 0 }]

describe('upsert_product_bundle_links — 반대 방향 중첩 차단(#601)', () => {
  it('RN-1: A→B 등록 후 B→C 등록은 BUNDLE_IS_PART_OF_PACKAGE로 거부된다', async () => {
    const a = await makeProduct('A'), b = await makeProduct('B'), c = await makeProduct('C')
    const first = await admin.rpc('upsert_product_bundle_links', { p_product_id: a, p_bundle_links: link(b) })
    expect(first.error).toBeNull()
    const second = await admin.rpc('upsert_product_bundle_links', { p_product_id: b, p_bundle_links: link(c) })
    expect(second.error?.message).toContain('BUNDLE_IS_PART_OF_PACKAGE')
  })

  it('RN-2: 기존 방향(부품이 이미 패키지) 차단은 그대로 BUNDLE_NESTING_FORBIDDEN', async () => {
    const a = await makeProduct('A'), b = await makeProduct('B'), c = await makeProduct('C')
    expect((await admin.rpc('upsert_product_bundle_links', { p_product_id: b, p_bundle_links: link(c) })).error).toBeNull()
    const res = await admin.rpc('upsert_product_bundle_links', { p_product_id: a, p_bundle_links: link(b) })
    expect(res.error?.message).toContain('BUNDLE_NESTING_FORBIDDEN')
  })

  it('RN-3: 부품으로 쓰이는 상품도 빈 목록 저장(정리)은 허용된다', async () => {
    const a = await makeProduct('A'), b = await makeProduct('B')
    expect((await admin.rpc('upsert_product_bundle_links', { p_product_id: a, p_bundle_links: link(b) })).error).toBeNull()
    const res = await admin.rpc('upsert_product_bundle_links', { p_product_id: b, p_bundle_links: [] })
    expect(res.error).toBeNull()
  })

  it('RN-4: 서로 무관한 두 패키지가 같은 부품을 공유하는 것은 허용된다', async () => {
    const a = await makeProduct('A'), b = await makeProduct('B'), part = await makeProduct('P')
    expect((await admin.rpc('upsert_product_bundle_links', { p_product_id: a, p_bundle_links: link(part) })).error).toBeNull()
    expect((await admin.rpc('upsert_product_bundle_links', { p_product_id: b, p_bundle_links: link(part) })).error).toBeNull()
  })

  it('RN-5: 부품을 링크에서 빼면(패키지 목록 정리) 그 상품이 다시 자기 목록을 만들 수 있다', async () => {
    const a = await makeProduct('A'), b = await makeProduct('B'), c = await makeProduct('C')
    await admin.rpc('upsert_product_bundle_links', { p_product_id: a, p_bundle_links: link(b) })
    await admin.rpc('upsert_product_bundle_links', { p_product_id: a, p_bundle_links: [] })
    const res = await admin.rpc('upsert_product_bundle_links', { p_product_id: b, p_bundle_links: link(c) })
    expect(res.error).toBeNull()
  })
})
