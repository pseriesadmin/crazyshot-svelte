/**
 * optionLinksGuard.test.ts — Migration #853 (2026-11-26, Stephen 지시 "1~3번만 반영")
 * 옵션상품 연결 저장(upsert_product_option_links) 서버 검증:
 *   자기 자신 · 재고 단위(자식) · 삭제된 상품 · 같은 상품의 결합 구성품 (패키지형 상품은 옵션으로 허용) — 새로 추가하는 항목만 차단.
 *   이미 연결돼 있던 항목은 재저장해도 막지 않는다(기존 데이터 보호).
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트. fixture는 이 파일이 직접 만들고 afterEach에서 정리한다.
 * 화면 연결(오류 문구·자동완성 자기 제외)은 소스 연결 검사로 확인한다.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const created: string[] = []

afterEach(async () => {
  if (created.length === 0) return
  await admin.from('product_option_links').delete().in('product_id', created)
  await admin.from('product_option_links').delete().in('option_product_id', created)
  await admin.from('product_bundle_links').delete().in('product_id', created)
  await admin.from('product_bundle_links').delete().in('bundle_product_id', created)
  // 자식 먼저 삭제 후 부모 삭제
  await admin.from('products').delete().in('parent_product_id', created)
  await admin.from('products').delete().in('id', created)
  created.length = 0
}, 60000)

async function makeProduct(label: string, extra: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await admin
    .from('products')
    .insert({
      name: `[TDD-OPT] ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      category: 'other',
      is_active: true,
      ...extra,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`상품 생성 실패: ${error?.message}`)
  created.push(data.id as string)
  return data.id as string
}

const opt = (id: string, extra: Record<string, unknown> = {}) => [{ option_product_id: id, display_order: 0, ...extra }]
const save = (productId: string, links: unknown[]) =>
  admin.rpc('upsert_product_option_links', { p_product_id: productId, p_option_links: links })

describe('upsert_product_option_links — 옵션상품 등록 검증(#853)', () => {
  it('OP-1: 자기 자신을 옵션으로 저장하면 OPTION_SELF_REF로 거부된다', async () => {
    const a = await makeProduct('A')
    const res = await save(a, opt(a))
    expect(res.error?.message).toContain('OPTION_SELF_REF')
  })

  it('OP-2: 재고 단위(자식) 상품은 OPTION_CHILD_PRODUCT로 거부된다', async () => {
    const a = await makeProduct('A'), parent = await makeProduct('P')
    const child = await makeProduct('C', { parent_product_id: parent })
    const res = await save(a, opt(child))
    expect(res.error?.message).toContain('OPTION_CHILD_PRODUCT')
  })

  it('OP-3: 삭제된 상품은 OPTION_DELETED_PRODUCT로 거부된다', async () => {
    const a = await makeProduct('A')
    const gone = await makeProduct('G', { deleted_at: new Date().toISOString() })
    const res = await save(a, opt(gone))
    expect(res.error?.message).toContain('OPTION_DELETED_PRODUCT')
  })

  it('OP-4: 패키지형 상품을 옵션으로 추가할 수 있다(허용 정책)', async () => {
    const a = await makeProduct('A')
    const pkg = await makeProduct('PKG', { is_bundle_product: true })
    const res = await save(a, opt(pkg))
    expect(res.error).toBeNull()
  })

  it('OP-5: 같은 상품의 결합 구성품을 새로 옵션으로 추가하면 OPTION_BUNDLE_OVERLAP으로 거부된다', async () => {
    const a = await makeProduct('A', { is_bundle_product: true }), part = await makeProduct('PART')
    expect((await admin.rpc('upsert_product_bundle_links', { p_product_id: a, p_bundle_links: [{ bundle_product_id: part, display_order: 0 }] })).error).toBeNull()
    const res = await save(a, opt(part))
    expect(res.error?.message).toContain('OPTION_BUNDLE_OVERLAP')
  })

  it('OP-6: 정상 단품 옵션은 저장되고 설정값이 반영된다', async () => {
    const a = await makeProduct('A'), o = await makeProduct('O')
    const res = await save(a, opt(o, { is_required: true, is_free: true }))
    expect(res.error).toBeNull()
    const { data } = await admin.from('product_option_links').select('is_required, is_free').eq('product_id', a).eq('option_product_id', o).is('deleted_at', null).single()
    expect(data).toEqual({ is_required: true, is_free: true })
  })

  it('OP-7: 이미 연결돼 있던 구성품 겹침 항목은 재저장해도 막지 않는다(기존 데이터 보호)', async () => {
    const a = await makeProduct('A', { is_bundle_product: true })
    const pkg = await makeProduct('PKG', { is_bundle_product: true })
    const part = await makeProduct('PART')
    await admin.rpc('upsert_product_bundle_links', { p_product_id: a, p_bundle_links: [{ bundle_product_id: part, display_order: 0 }] })
    // 규칙 도입 전에 이미 연결돼 있던 상태를 테이블 직접 삽입으로 재현
    const ins = await admin.from('product_option_links').insert([
      { product_id: a, option_product_id: pkg, display_order: 0 },
      { product_id: a, option_product_id: part, display_order: 1 },
    ])
    expect(ins.error).toBeNull()
    const res = await save(a, [
      { option_product_id: pkg, display_order: 0, is_required: true },
      { option_product_id: part, display_order: 1 },
    ])
    expect(res.error).toBeNull()
  })

  it('OP-8: 기존 항목이 있어도 새로 추가하는 자식(재고 단위)은 여전히 거부된다', async () => {
    const a = await makeProduct('A'), o = await makeProduct('O'), parent = await makeProduct('P')
    const child = await makeProduct('C', { parent_product_id: parent })
    expect((await save(a, opt(o))).error).toBeNull()
    const res = await save(a, [{ option_product_id: o, display_order: 0 }, { option_product_id: child, display_order: 1 }])
    expect(res.error?.message).toContain('OPTION_CHILD_PRODUCT')
  })

  it('OP-9: 검증에 걸린 저장은 기존 목록을 바꾸지 않는다(전체 롤백)', async () => {
    const a = await makeProduct('A'), o = await makeProduct('O')
    expect((await save(a, opt(o))).error).toBeNull()
    expect((await save(a, opt(a))).error?.message).toContain('OPTION_SELF_REF')
    const { data } = await admin.from('product_option_links').select('option_product_id').eq('product_id', a).is('deleted_at', null)
    expect((data ?? []).map((r) => r.option_product_id)).toEqual([o])
  })

  it('OP-10: 빈 목록 저장(정리)은 항상 허용된다', async () => {
    const a = await makeProduct('A'), o = await makeProduct('O')
    expect((await save(a, opt(o))).error).toBeNull()
    expect((await save(a, [])).error).toBeNull()
  })
})

describe('화면·서버 연결(#853)', () => {
  const read = (p: string): string => readFileSync(p, 'utf8')

  it('OPT-UI-1: 옵션 저장 서버 액션이 4가지 오류 코드를 쉬운 문구로 돌려준다', () => {
    const src = read('src/routes/cms/products/+page.server.ts')
    for (const code of ['OPTION_SELF_REF', 'OPTION_CHILD_PRODUCT', 'OPTION_DELETED_PRODUCT', 'OPTION_BUNDLE_OVERLAP']) {
      expect(src).toContain(code)
    }
  })

  it('OPT-UI-2: 옵션 자동완성은 현재 상품을 후보에서 제외하고, 추가 함수도 자기 자신을 막는다', () => {
    const src = read('src/lib/components/cms/ProductDetailPanel.svelte')
    const block = src.slice(src.indexOf('id="opt-search"'), src.indexOf('id="opt-search"') + 400)
    expect(block).toContain('excludeId=')
    const fn = src.slice(src.indexOf('function addOptionProduct'), src.indexOf('function removeOption'))
    expect(fn).toMatch(/item\.id === (product\.id|savedSelfId)|product\.id === item\.id/)
  })
})
