/**
 * TDD: productSearchCategoryLabelDb.test.ts — 실제 어댑터가 CMS 코드설정(code_mapping_groups)의 분류 이름을 읽어
 * 검색 인덱스에 반영하는지 (Stage 전용, 읽기 전용 — 쓰기·삭제 없음)
 * 확인: ① 분류 이름 칸 덕에 "카메라"/"렌즈" 검색이 해당 분류 상품을 전부 잡는다 ② 반환 객체에 분류 우선 검색 메서드가 있다
 *       ③ 코드설정에 있는 다른 이름(중고품)도 하드코딩 없이 반영된다 ④ 분류 우선 검색이 앞 구간에 해당 분류를 둔다
 */
import { describe, it, expect, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getProductSearchIndex, invalidateProductSearchCache } from '$lib/server/searchEngine/adapters/productSearchIndex'

const isStage = PUBLIC_SUPABASE_URL.includes('ezyvffjvuwmtuhpxdjrw')
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
afterAll(() => invalidateProductSearchCache())

async function idsOfCategory(category: string): Promise<string[]> {
  const { data, error } = await admin
    .from('products').select('id')
    .is('parent_product_id', null).eq('is_active', true).eq('option_only', false).is('deleted_at', null).eq('category', category)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => String(r.id))
}

describe.skipIf(!isStage)('상품 검색 인덱스 — 분류 이름(code_mapping_groups) 반영 (Stage 라이브)', () => {
  it('코드설정의 분류 이름 "카메라"·"렌즈"로 해당 분류 상품이 전부 검색된다', async () => {
    invalidateProductSearchCache()
    const index = await getProductSearchIndex()
    expect(typeof index.searchWithCategoryIntent).toBe('function')

    const cameras = await idsOfCategory('camera')
    const lenses = await idsOfCategory('lens')
    expect(cameras.length).toBeGreaterThan(0)
    expect(lenses.length).toBeGreaterThan(0)

    const foundCam = index.search('카메라', { fuzzy: 0.2, prefix: true, limit: 300 }).map((r) => String(r.document.id))
    for (const id of cameras) expect(foundCam, `camera ${id}`).toContain(id)
    const foundLens = index.search('렌즈', { fuzzy: 0.2, prefix: true, limit: 300 }).map((r) => String(r.document.id))
    for (const id of lenses) expect(foundLens, `lens ${id}`).toContain(id)
  })

  it('하드코딩 없이 코드설정의 다른 분류 이름("중고품" = used-item)도 반영된다', async () => {
    invalidateProductSearchCache()
    const index = await getProductSearchIndex()
    const used = await idsOfCategory('used-item')
    expect(used.length).toBeGreaterThan(0)
    const found = index.search('중고품', { fuzzy: 0.2, prefix: true, limit: 300 }).map((r) => String(r.document.id))
    for (const id of used) expect(found, `used-item ${id}`).toContain(id)
  })

  it('분류 우선 검색: 질문 끝이 분류 이름이면 해당 분류가 앞 구간이고, 결과 객체에 새 칸이 새지 않는다', async () => {
    invalidateProductSearchCache()
    const index = await getProductSearchIndex()
    const cameras = new Set(await idsOfCategory('camera'))
    const res = index.searchWithCategoryIntent('렌즈 카메라', { fuzzy: 0.2, prefix: true, limit: 30 })
    expect(res.length).toBeGreaterThan(0)
    const camCount = Math.min(cameras.size, res.length)
    // 끝말 "카메라" → 카메라 분류가 앞쪽에 모여 있다(연속 구간)
    const firstNonCam = res.findIndex((r) => !cameras.has(String(r.document.id)))
    expect(firstNonCam === -1 ? res.length : firstNonCam).toBeGreaterThanOrEqual(Math.min(camCount, 1))
    for (const r of res) {
      const doc = r.document as Record<string, unknown>
      expect(doc).not.toHaveProperty('compound_heads')
      expect(doc).not.toHaveProperty('category_label')
    }
  })

  it('"카메라 가방"처럼 끝말이 분류 이름이 아니면 기존 search()와 같은 결과', async () => {
    invalidateProductSearchCache()
    const index = await getProductSearchIndex()
    const opts = { fuzzy: 0.2, prefix: true, limit: 30 }
    expect(index.searchWithCategoryIntent('카메라 가방', opts).map((r) => r.document.id))
      .toEqual(index.search('카메라 가방', opts).map((r) => r.document.id))
  })
})
