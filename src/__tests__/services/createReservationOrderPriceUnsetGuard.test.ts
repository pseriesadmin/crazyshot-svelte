/**
 * createReservationOrderPriceUnsetGuard.test.ts
 * create_reservation_order — 24h 요금 미등록 대여 상품 서버측 차단 (Migration 587)
 *
 * 배경: 장바구니 화면만 막고 있어 API 직접 호출로 0원 주문이 가능했다(TASK.md 3차 QA 잔여 ①).
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트 — 전용 임시 상품·사용자·예약 사용 후 정리.
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

const tag = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

async function makeUser(): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `tdd-priceunset-${tag()}@example.com`, password: 'Test1234!', email_confirm: true,
  })
  if (error || !data.user) throw new Error(`임시 사용자 생성 실패: ${error?.message}`)
  const id = data.user.id
  cleanups.push(async () => { await admin.auth.admin.deleteUser(id) })
  return id
}

type Rule = { price: number; deleted?: boolean; inactive?: boolean }

async function makeUnit(o: { rule24h?: Rule; saleOnly?: boolean }): Promise<string> {
  const name = `tdd-priceunset-${tag()}`
  const { data, error } = await admin
    .from('products')
    .insert({
      name, category: 'TDD', slug: name, is_active: false,
      ...(o.saleOnly ? { sale_only: true, sale_price: 30000 } : {}),
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`임시 상품 생성 실패: ${error?.message}`)
  const id = data.id as string
  cleanups.push(async () => {
    await admin.from('price_rules').delete().eq('product_id', id)
    await admin.from('products').delete().eq('id', id)
  })
  if (o.rule24h) {
    const { error: e } = await admin.from('price_rules').insert({
      product_id: id, duration_type: '24h', price: o.rule24h.price,
      is_active: !(o.rule24h.deleted || o.rule24h.inactive),
      deleted_at: o.rule24h.deleted ? new Date().toISOString() : null,
    })
    if (e) throw new Error(`price_rules 생성 실패: ${e.message}`)
  }
  return id
}

async function makeHold(userId: string, productId: string, dayOffset: number): Promise<number> {
  const d = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
  const { data, error } = await admin
    .from('rental_reservations')
    .insert({
      product_id: productId, user_id: userId, status: 'hold',
      start_date: d(400 + dayOffset), end_date: d(401 + dayOffset),
      pickup_time: '10:00', return_time: '10:00', pickup_method: 'visit',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`임시 예약 생성 실패: ${error?.message}`)
  const rid = data.id as number
  cleanups.push(async () => {
    const { data: items } = await admin.from('order_items').select('order_id').eq('reservation_id', rid)
    await admin.from('order_items').delete().eq('reservation_id', rid)
    for (const it of (items ?? []) as { order_id: number }[]) {
      await admin.from('orders').delete().eq('id', it.order_id)
    }
    await admin.from('rental_reservations').delete().eq('id', rid)
  })
  return rid
}

async function createOrder(userId: string, ids: number[]) {
  return admin.rpc('create_reservation_order', {
    p_user_id: userId, p_reservation_ids: ids, p_selected_coupon_id: null,
    p_selected_points: 0, p_delivery_fee: 0,
  })
}

async function itemCount(ids: number[]): Promise<number> {
  const { count } = await admin.from('order_items').select('id', { count: 'exact', head: true }).in('reservation_id', ids)
  return count ?? 0
}

describe('[TDD] create_reservation_order — 24h 요금 미등록 서버 차단 (Migration 587)', () => {
  it('PU-1: 24h 요금 없는 대여 상품 → PRICE_UNSET으로 차단, order_items 미생성', async () => {
    const user = await makeUser()
    const rid = await makeHold(user, await makeUnit({}), 0)
    const { data, error } = await createOrder(user, [rid])
    expect(error?.message ?? '').toMatch(/PRICE_UNSET/)
    expect(data).toBeNull()
    expect(await itemCount([rid])).toBe(0)
  })

  it('PU-2 [회귀]: 24h 요금이 있으면 정상 주문 생성(금액 반영)', async () => {
    const user = await makeUser()
    const rid = await makeHold(user, await makeUnit({ rule24h: { price: 100000 } }), 0)
    const { data, error } = await createOrder(user, [rid])
    expect(error).toBeNull()
    expect(data?.[0]?.order_id).toBeTruthy()
    expect(await itemCount([rid])).toBe(1)
  })

  it('PU-3: 판매전용(sale_only)은 24h 요금이 없어도 차단하지 않는다', async () => {
    const user = await makeUser()
    const rid = await makeHold(user, await makeUnit({ saleOnly: true }), 0)
    const { error } = await createOrder(user, [rid])
    expect(error).toBeNull()
    expect(await itemCount([rid])).toBe(1)
  })

  it('PU-4: 삭제된(soft-delete) 24h 요금만 있으면 미등록으로 본다 → 차단', async () => {
    const user = await makeUser()
    const rid = await makeHold(user, await makeUnit({ rule24h: { price: 100000, deleted: true } }), 0)
    const { error } = await createOrder(user, [rid])
    expect(error?.message ?? '').toMatch(/PRICE_UNSET/)
    expect(await itemCount([rid])).toBe(0)
  })

  it('PU-5: 비활성(is_active=false) 24h 요금만 있어도 차단', async () => {
    const user = await makeUser()
    const rid = await makeHold(user, await makeUnit({ rule24h: { price: 100000, inactive: true } }), 0)
    const { error } = await createOrder(user, [rid])
    expect(error?.message ?? '').toMatch(/PRICE_UNSET/)
  })

  it('PU-6: 정상 상품과 미등록 상품이 섞이면 전체 실패 — 정상 예약에도 order_items가 생기지 않는다', async () => {
    const user = await makeUser()
    const good = await makeHold(user, await makeUnit({ rule24h: { price: 100000 } }), 0)
    const bad = await makeHold(user, await makeUnit({}), 0)
    const { error } = await createOrder(user, [good, bad])
    expect(error?.message ?? '').toMatch(/PRICE_UNSET/)
    expect(await itemCount([good, bad])).toBe(0)
  })

  it('PU-7 [멱등]: 이미 order_items가 있는 예약은 이후 요금이 사라져도 재호출이 차단되지 않는다', async () => {
    const user = await makeUser()
    const unit = await makeUnit({ rule24h: { price: 100000 } })
    const rid = await makeHold(user, unit, 0)
    expect((await createOrder(user, [rid])).error).toBeNull()
    await admin.from('price_rules').update({ is_active: false, deleted_at: new Date().toISOString() }).eq('product_id', unit)
    const again = await createOrder(user, [rid])
    expect(again.error).toBeNull()
    expect(await itemCount([rid])).toBe(1)
  })
})
