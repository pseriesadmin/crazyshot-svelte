/**
 * TDD: 전자계약 데이터(contract-data API)의 상품명은 부모 이름을 따른다
 * (자식 재고 부모 참조 전환 Phase 3-B — 고객 계약 화면(contract/[token])과 같은 기준)
 *
 * 부모·자식 이름이 다른 픽스처로, 발행 데이터의 상품명이 부모 이름인지(옛 자식 이름이 아닌지) 확인하고
 * 부모 없는 단독 상품은 자기 이름 그대로인지 회귀로 확인한다. 품번(product_code)은 자식 고유값이라 그대로 나온다.
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트 — 전용 임시 상품·사용자를 만들고 종료 시 삭제한다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: vi.fn(async () => null) }))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: vi.fn(async () => 'manager') }))

const { GET } = await import('../../routes/api/cms/reservations/[id]/contract-data/+server')

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

const tag = () => `tdd-cdname-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

async function makeProduct(o: { parentId?: string; name: string }): Promise<string> {
  const slug = tag()
  const { data, error } = await admin
    .from('products')
    .insert({
      name: o.name, category: 'TDD', slug, is_active: !!o.parentId, image_urls: [],
      ...(o.parentId ? { parent_product_id: o.parentId } : {}),
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`임시 상품 생성 실패: ${error?.message}`)
  const id = data.id as string
  cleanups.push(async () => { await admin.from('products').delete().eq('id', id) })
  return id
}

async function makeReservation(productId: string): Promise<number> {
  const email = `${tag()}@example.com`
  const { data: u, error: ue } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (ue || !u.user) throw new Error(`임시 사용자 생성 실패: ${ue?.message}`)
  const userId = u.user.id
  cleanups.push(async () => { await admin.auth.admin.deleteUser(userId) })
  const { data, error } = await admin
    .from('rental_reservations')
    .insert({
      product_id: productId, user_id: userId, status: 'hold',
      start_date: '2030-07-10', end_date: '2030-07-11',
      pickup_time: '10:00', return_time: '10:00', pickup_method: 'visit', return_method: 'visit',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`임시 예약 생성 실패: ${error?.message}`)
  const rid = data.id as number
  cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', rid) })
  return rid
}

async function contractData(rid: number): Promise<string> {
  const res = await GET({ params: { id: String(rid) }, locals: {} } as Parameters<typeof GET>[0])
  expect(res.status).toBe(200)
  return JSON.stringify(await res.json())
}

describe('[TDD] contract-data API — 상품명은 부모 이름', () => {
  it('CD-1 부모·자식 이름이 다를 때 계약 데이터에 부모 이름이 들어가고 옛 자식 이름은 없다', async () => {
    const t = tag()
    const parentName = `부모이름-${t}`
    const childName = `옛자식이름-${t}`
    const parent = await makeProduct({ name: parentName })
    const child = await makeProduct({ parentId: parent, name: childName })
    const text = await contractData(await makeReservation(child))
    expect(text).toContain(parentName)
    expect(text).not.toContain(childName)
  })

  it('CD-2 [회귀] 부모 없는 단독 상품은 자기 이름 그대로', async () => {
    const t = tag()
    const soloName = `단독-${t}`
    const solo = await makeProduct({ name: soloName })
    const text = await contractData(await makeReservation(solo))
    expect(text).toContain(soloName)
  })
})
