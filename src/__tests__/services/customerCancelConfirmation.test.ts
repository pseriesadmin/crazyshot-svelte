/**
 * customerCancelConfirmation.test.ts — 고객 취소 "취소중" → 관리자 취소확인 (Migration 589)
 * Stage DB 라이브 통합테스트(임시 사용자·상품·예약만 사용 후 정리)
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []
afterEach(async () => {
  while (cleanups.length) { const fn = cleanups.pop(); if (fn) await fn().catch(() => undefined) }
})
const tag = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

async function makeUser(): Promise<{ id: string; client: SupabaseClient }> {
  const email = `tdd-cancelconf-${tag()}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !data.user) throw new Error(`사용자 생성 실패: ${error?.message}`)
  const id = data.user.id
  cleanups.push(async () => {
    await admin.from('order_items').delete().in('reservation_id', (await admin.from('rental_reservations').select('id').eq('user_id', id)).data?.map(r => (r as { id: number }).id) ?? [])
    await admin.from('rental_reservations').delete().eq('user_id', id)
    await admin.auth.admin.deleteUser(id)
  })
  const client = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
  const { error: se } = await client.auth.signInWithPassword({ email, password: 'Test1234!' })
  if (se) throw new Error(`로그인 실패: ${se.message}`)
  return { id, client }
}

async function makeProduct(): Promise<string> {
  const name = `tdd-cancelconf-${tag()}`
  const { data, error } = await admin.from('products').insert({ name, category: 'TDD', slug: name, is_active: false }).select('id').single()
  if (error || !data) throw new Error(`상품 생성 실패: ${error?.message}`)
  const id = data.id as string
  cleanups.push(async () => { await admin.from('products').delete().eq('id', id) })
  return id
}

let dayCounter = 0
async function makeReservation(userId: string, status: string): Promise<number> {
  const productId = await makeProduct()
  dayCounter++
  const d = (n: number) => new Date(Date.UTC(2033, 0, 1) + (dayCounter * 5 + n) * 86400000).toISOString().slice(0, 10)
  const { data, error } = await admin.from('rental_reservations')
    .insert({ user_id: userId, product_id: productId, status, start_date: d(0), end_date: d(1), pickup_method: 'visit' })
    .select('id').single()
  if (error || !data) throw new Error(`예약 생성 실패: ${error?.message}`)
  return (data as { id: number }).id
}

const ACTIVE_OR = 'status.in.(hold,confirmed,shipped,in_use,return_requested,returned,completed),and(status.eq.cancelled,customer_cancelled_at.not.is.null,cancel_confirmed_at.is.null)'
const CANCEL_OR = 'customer_cancelled_at.is.null,cancel_confirmed_at.not.is.null'

async function listActive(client: SupabaseClient, uid: string): Promise<number[]> {
  const { data, error } = await client.from('rental_reservations').select('id').eq('user_id', uid).or(ACTIVE_OR)
  expect(error).toBeNull()
  return ((data ?? []) as Array<{ id: number }>).map(r => r.id)
}
async function listCancelled(client: SupabaseClient, uid: string): Promise<number[]> {
  const { data, error } = await client.from('rental_reservations').select('id').eq('user_id', uid).in('status', ['cancelled']).or(CANCEL_OR)
  expect(error).toBeNull()
  return ((data ?? []) as Array<{ id: number }>).map(r => r.id)
}

describe('[TDD] 고객 취소 → 취소중 → 관리자 취소확인 (Migration 589)', () => {
  it('CC-1: 고객 취소 표식 전에는 취소 목록, 표식 후에는 대여 목록(취소중)에만 보인다', async () => {
    const u = await makeUser()
    const rid = await makeReservation(u.id, 'cancelled') // 관리자/레거시 취소(표식 없음)
    expect(await listCancelled(u.client, u.id)).toContain(rid)
    expect(await listActive(u.client, u.id)).not.toContain(rid)

    const { data } = await admin.rpc('mark_customer_cancelled', { p_reservation_ids: [rid] })
    expect(data).toBe(1)
    expect(await listActive(u.client, u.id)).toContain(rid)     // 취소중 — 대여 목록에 남음
    expect(await listCancelled(u.client, u.id)).not.toContain(rid) // 취소 목록에는 아직 없음
  })

  it('CC-2: mark_customer_cancelled는 cancelled 상태만 표식하고 멱등이다', async () => {
    const u = await makeUser()
    const hold = await makeReservation(u.id, 'hold')
    const canc = await makeReservation(u.id, 'cancelled')
    const { data: n1 } = await admin.rpc('mark_customer_cancelled', { p_reservation_ids: [hold, canc] })
    expect(n1).toBe(1)
    const { data: n2 } = await admin.rpc('mark_customer_cancelled', { p_reservation_ids: [hold, canc] })
    expect(n2).toBe(0)
    const { data: row } = await admin.from('rental_reservations').select('customer_cancelled_at').eq('id', hold).single()
    expect((row as { customer_cancelled_at: string | null }).customer_cancelled_at).toBeNull()
  })

  it('CC-3: 관리자 취소확인 → 취소 목록으로 이동(대여 목록에서 사라짐), 재호출은 already', async () => {
    const u = await makeUser()
    const rid = await makeReservation(u.id, 'cancelled')
    await admin.rpc('mark_customer_cancelled', { p_reservation_ids: [rid] })
    const adminId = u.id // 확인자 id는 형식상 uuid면 충분
    const { data: r1 } = await admin.rpc('confirm_customer_cancel', { p_reservation_id: rid, p_admin_id: adminId })
    expect(r1).toMatchObject({ ok: true, confirmed_count: 1 })
    expect(await listActive(u.client, u.id)).not.toContain(rid)
    expect(await listCancelled(u.client, u.id)).toContain(rid)
    const { data: r2 } = await admin.rpc('confirm_customer_cancel', { p_reservation_id: rid, p_admin_id: adminId })
    expect(r2).toMatchObject({ ok: true, already: true })
  })

  it('CC-4: 고객이 취소하지 않은 예약(관리자 취소·진행중)은 취소확인 대상이 아니다', async () => {
    const u = await makeUser()
    const adminCancelled = await makeReservation(u.id, 'cancelled')
    const confirmed = await makeReservation(u.id, 'confirmed')
    expect((await admin.rpc('confirm_customer_cancel', { p_reservation_id: adminCancelled, p_admin_id: u.id })).data).toMatchObject({ ok: false, error: 'not_customer_cancelled' })
    expect((await admin.rpc('confirm_customer_cancel', { p_reservation_id: confirmed, p_admin_id: u.id })).data).toMatchObject({ ok: false, error: 'not_customer_cancelled' })
    expect((await admin.rpc('confirm_customer_cancel', { p_reservation_id: 999999999, p_admin_id: u.id })).data).toMatchObject({ ok: false, error: 'not_found' })
  })

  it('CC-5: 같은 주문으로 함께 취소된 형제 예약도 한 번의 취소확인으로 함께 확인된다', async () => {
    const u = await makeUser()
    const a = await makeReservation(u.id, 'cancelled')
    const b = await makeReservation(u.id, 'cancelled')
    const { data: order } = await admin.from('orders').insert({ order_key: `TDD-CC-${tag()}`, user_id: u.id, total_amount: 0, final_amount: 0, status: 'cancelled' }).select('id').single()
    const orderId = (order as { id: number }).id
    cleanups.push(async () => { await admin.from('orders').delete().eq('id', orderId) })
    await admin.from('order_items').insert([
      { order_id: orderId, reservation_id: a, product_id: (await admin.from('rental_reservations').select('product_id').eq('id', a).single()).data?.product_id, quantity: 1, unit_price: 0, line_total: 0 },
      { order_id: orderId, reservation_id: b, product_id: (await admin.from('rental_reservations').select('product_id').eq('id', b).single()).data?.product_id, quantity: 1, unit_price: 0, line_total: 0 },
    ])
    await admin.rpc('mark_customer_cancelled', { p_reservation_ids: [a, b] })
    const { data } = await admin.rpc('confirm_customer_cancel', { p_reservation_id: a, p_admin_id: u.id })
    expect(data).toMatchObject({ ok: true, confirmed_count: 2 })
    expect(await listActive(u.client, u.id)).not.toEqual(expect.arrayContaining([a]))
    expect((await listCancelled(u.client, u.id)).sort()).toEqual([a, b].sort())
  })

  it('CC-6: 고객(authenticated)은 표식·확인 RPC를 직접 호출할 수 없다', async () => {
    const u = await makeUser()
    const rid = await makeReservation(u.id, 'cancelled')
    const r1 = await u.client.rpc('mark_customer_cancelled', { p_reservation_ids: [rid] })
    expect(r1.error).not.toBeNull()
    const r2 = await u.client.rpc('confirm_customer_cancel', { p_reservation_id: rid, p_admin_id: u.id })
    expect(r2.error).not.toBeNull()
  })
})
