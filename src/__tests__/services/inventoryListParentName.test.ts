/**
 * TDD: CMS 재고(자식) 목록의 이름은 부모 이름을 따른다 (자식 재고 부모 참조 전환 후속, 2026-10-08)
 *
 * 증상: 부모 상품 이름을 "최고의 Sony FX6-12"로 바꿔도 CMS 상품목록 재고 아코디언·이력관리 화면의
 *       재고 줄에는 자식 행에 복사돼 있던 옛 이름("Sony FX6-12")이 그대로 보였다 — 두 화면의 재고 목록
 *       조회가 자식의 name 칼럼을 직접 읽고 있었기 때문. 품번·활성 여부는 자식 고유값이라 그대로여야 한다.
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트 — 전용 임시 상품을 만들고 종료 시 삭제한다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { loadSelectedProductDetail } from '$lib/server/products/loadSelectedProductDetail'

vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => PUBLIC_SUPABASE_URL }))

const { load: loadHistoryPage } = await import('../../routes/cms/rental/history/+page.server')

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

const tag = () => `tdd-invname-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

async function makeProduct(o: { parentId?: string; name: string; isActive?: boolean; code?: string }): Promise<string> {
  const slug = tag()
  const { data, error } = await admin
    .from('products')
    .insert({
      name: o.name, category: 'TDD', slug, is_active: o.isActive ?? true, image_urls: [],
      ...(o.parentId ? { parent_product_id: o.parentId } : {}),
      ...(o.code ? { product_code: o.code } : {}),
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`임시 상품 생성 실패: ${error?.message}`)
  const id = data.id as string
  cleanups.push(async () => { await admin.from('products').delete().eq('id', id) })
  return id
}

async function fixture() {
  const t = tag()
  const parentName = `최고의-부모-${t}`
  const oldChildName = `옛자식-${t}`
  const parent = await makeProduct({ name: parentName })
  const c1 = await makeProduct({ parentId: parent, name: oldChildName, code: `TDDINV${t.slice(-6).toUpperCase()}1` })
  const c2 = await makeProduct({ parentId: parent, name: oldChildName, isActive: false, code: `TDDINV${t.slice(-6).toUpperCase()}2` })
  return { parent, c1, c2, parentName, oldChildName }
}

describe('[TDD] 재고 목록 이름 — 부모 우선', () => {
  it('IN-1 상품목록 로더: 대표(부모) 선택 시 재고 이름이 부모 이름이다(옛 자식 이름이 아님)', async () => {
    const f = await fixture()
    const d = await loadSelectedProductDetail(admin, f.parent)
    expect(d.inventoryList).toHaveLength(2)
    for (const u of d.inventoryList) {
      expect(u.name).toBe(f.parentName)
      expect(u.name).not.toBe(f.oldChildName)
    }
  })

  it('IN-2 상품목록 로더: 재고(자식) 선택으로 열어도 같은 재고 목록이 부모 이름이다', async () => {
    const f = await fixture()
    const d = await loadSelectedProductDetail(admin, f.c1)
    expect(d.inventoryList.map((u) => u.name)).toEqual([f.parentName, f.parentName])
  })

  it('IN-3 품번·활성 여부는 자식 고유값이라 바뀌지 않는다', async () => {
    const f = await fixture()
    const d = await loadSelectedProductDetail(admin, f.parent)
    const byId = Object.fromEntries(d.inventoryList.map((u) => [u.id, u]))
    expect(byId[f.c1].product_code).toMatch(/^TDDINV.*1$/)
    expect(byId[f.c1].is_active).toBe(true)
    expect(byId[f.c2].is_active).toBe(false)
  })

  it('IN-4 [회귀] 재고가 없는 단독 상품은 빈 목록', async () => {
    const solo = await makeProduct({ name: `단독-${tag()}` })
    const d = await loadSelectedProductDetail(admin, solo)
    expect(d.inventoryList).toEqual([])
  })

  it('IN-5 이력관리 화면 로더: 재고 이름이 부모 이름이다', async () => {
    const f = await fixture()
    const event = {
      locals: { safeGetSession: async () => ({ session: { user: { id: 'tdd' } } }) },
      url: new URL(`http://localhost/cms/rental/history?selected=${f.parent}`),
    } as unknown as Parameters<typeof loadHistoryPage>[0]
    const result = (await loadHistoryPage(event)) as { inventoryList?: Array<{ name: string }> }
    expect(result.inventoryList).toHaveLength(2)
    for (const u of result.inventoryList ?? []) {
      expect(u.name).toBe(f.parentName)
    }
  })
})
