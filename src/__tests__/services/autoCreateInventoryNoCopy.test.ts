/**
 * TDD: auto_create_inventory_for_product — 신규 재고(자식)는 부모 값을 복사해 저장하지 않는다
 * (자식 재고 부모 참조 전환 Phase 5, products.md §2-16)
 *
 * 부모에 브랜드·설명·이미지·사양·구성품·키워드·콘텐츠블록·판매전용·판매가를 채운 뒤 재고를 자동 생성하고,
 * 자식 행에는 NOT NULL인 이름·분류와 슬러그·활성·부모 연결·QR만 들어가고 나머지는 기본값/NULL인지 확인한다.
 * 가격정책(price_rules) 복사와 부모 읽기 경로(부모 값으로 표시)는 그대로여야 한다.
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트 — 전용 임시 상품을 만들고 종료 시 삭제한다.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

const tag = () => `tdd-autoinv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

async function makeRichParent(): Promise<{ id: string; name: string; slug: string }> {
  const slug = tag()
  const name = `부모-${slug}`
  const { data, error } = await admin
    .from('products')
    .insert({
      name, slug, category: 'TDD', is_active: false,
      brand: 'TDD-BRAND', description: '부모 설명', product_caption: '부모 캡션',
      image_urls: ['https://example.com/p.png'], specifications: [{ key: 'k', value: 'v' }],
      components: [{ key: 'c', value: '1' }], keywords: ['k1', 'k2'], content_blocks: [{ type: 'text' }],
      sale_only: true, sale_price: 12345,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`임시 부모 생성 실패: ${error?.message}`)
  const id = data.id as string
  cleanups.push(async () => {
    await admin.from('price_rules').delete().eq('product_id', id)
    await admin.from('products').delete().eq('parent_product_id', id)
    await admin.from('products').delete().eq('id', id)
  })
  const { error: pe } = await admin.from('price_rules').insert({ product_id: id, duration_type: '24h', price: 77000, is_active: true })
  if (pe) throw new Error(`price_rules 생성 실패: ${pe.message}`)
  return { id, name, slug }
}

describe('[TDD] auto_create_inventory_for_product — 부모 값 복사 중단', () => {
  it('AI-1 자식에는 이름·분류·슬러그·활성·부모연결·QR만 들어가고 복사 칼럼은 기본값/NULL', async () => {
    const parent = await makeRichParent()
    const { data: childId, error } = await admin.rpc('auto_create_inventory_for_product', { p_product_id: parent.id })
    expect(error).toBeNull()
    expect(typeof childId).toBe('string')
    const { data: c } = await admin.from('products').select('*').eq('id', childId as string).single()
    expect(c).toMatchObject({ name: parent.name, category: 'TDD', is_active: true, parent_product_id: parent.id })
    expect(String(c?.slug)).toContain(`${parent.slug}-inv-`)
    expect(String(c?.qr_payload)).toContain(`/qr/product/${childId}`)
    expect(c?.brand).toBeNull()
    expect(c?.description).toBeNull()
    expect(c?.product_caption).toBeNull()
    expect(c?.image_urls).toEqual([])
    expect(c?.specifications).toEqual({})
    expect(c?.components).toBeNull()
    expect(c?.keywords).toEqual([])
    expect(c?.content_blocks).toEqual([])
    expect(c?.sale_only).toBe(false)
    expect(c?.sale_price).toBeNull()
  })

  it('AI-2 [회귀] 가격정책은 자식에 계속 복사된다(부모→자식 price_rules 동기화는 이번 범위 밖)', async () => {
    const parent = await makeRichParent()
    const { data: childId } = await admin.rpc('auto_create_inventory_for_product', { p_product_id: parent.id })
    const { data: rules } = await admin.from('price_rules').select('duration_type, price').eq('product_id', childId as string)
    expect(rules).toEqual([{ duration_type: '24h', price: 77000 }])
  })

  it('AI-3 [회귀] 부모 자신이 이미 자식이면 오류(기존 가드 유지)', async () => {
    const parent = await makeRichParent()
    const { data: childId } = await admin.rpc('auto_create_inventory_for_product', { p_product_id: parent.id })
    const { error } = await admin.rpc('auto_create_inventory_for_product', { p_product_id: childId as string })
    expect(error?.message ?? '').toContain('already a child')
  })

  it('AI-4 부모 읽기 경로: 새 자식이 비어 있어도 대여목록 이름·분류·이미지는 부모 값으로 나온다', async () => {
    const parent = await makeRichParent()
    const { data: childId } = await admin.rpc('auto_create_inventory_for_product', { p_product_id: parent.id })
    const email = `${tag()}@example.com`
    const { data: u } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
    const userId = u.user?.id as string
    cleanups.push(async () => { await admin.auth.admin.deleteUser(userId) })
    const { data: r, error: re } = await admin.from('rental_reservations').insert({
      product_id: childId as string, user_id: userId, status: 'hold', start_date: '2030-08-10', end_date: '2030-08-11',
      pickup_time: '10:00', return_time: '10:00', pickup_method: 'visit',
    }).select('id').single()
    expect(re).toBeNull()
    const rid = r?.id as number
    cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', rid) })
    const { data: rows } = await admin.rpc('get_rental_list', { p_reservation_id: rid, p_per_page: 50 })
    const row = ((rows ?? []) as Array<{ reservation_id: number; product_name: string; product_image_url: string | null }>).find(x => Number(x.reservation_id) === rid)
    expect(row?.product_name).toBe(parent.name)
    expect(row?.product_image_url).toBe('https://example.com/p.png')
  })
})
