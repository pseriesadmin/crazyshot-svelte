/**
 * TDD: orderCancelRestoreBenefits.test.ts — 주문이 전부 취소·만료되면 소진된 쿠폰·포인트를 되돌린다 (Migration #643·#644)
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트. fixture는 이 파일이 만들고 정리한다.
 *
 * 배경: 취소·환불·만료 경로(update_reservation_status · cancel_reservation_payment · release_reservation_hold) 어디에도
 *   결제 시 소진된 쿠폰(user_coupons.used_*)과 차감된 포인트(user_profiles.points)를 되돌리는 코드가 없었다.
 * 기대:
 *  - 주문에 묶인 모든 예약이 취소/만료 상태가 되는 순간 그 주문으로 소진된 쿠폰이 사용 가능 목록으로 복귀하고
 *    (used_at NULL · used_count 되돌림 · order_id NULL · coupons.usage_count 되돌림), 차감된 포인트가 잔액으로 복원된다
 *    (point_transactions type='refund', ref_type='order', ref_id=주문id 1건).
 *  - 일부 예약만 취소되고 다른 예약이 살아 있으면 되돌리지 않는다.
 *  - 여러 번 트리거돼도 이중 환원하지 않는다(멱등). 소진되지 않은 주문(결제 전)은 아무것도 바꾸지 않는다.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

let productId: string
const cleanups: Array<() => Promise<void>> = []

beforeAll(async () => {
  const { data: prod, error } = await admin.from('products')
    .insert({ name: `[TDD-CANCELRESTORE] ${Date.now()}`, category: 'other', is_active: true })
    .select('id').single()
  if (error || !prod) throw new Error(`테스트 상품 생성 실패: ${error?.message}`)
  productId = (prod as { id: string }).id
  const { error: prErr } = await admin.from('price_rules').insert({ product_id: productId, duration_type: '24h', price: 25000, is_active: true })
  if (prErr) throw new Error(`테스트 요금 생성 실패: ${prErr.message}`)
}, 60000)

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

afterAll(async () => {
  await admin.from('price_rules').delete().eq('product_id', productId).then(undefined, () => undefined)
  await admin.from('products').delete().eq('id', productId).then(undefined, () => undefined)
})

const _slotBase = Date.now() % 1000
let _slot = 0
function range(): { start: string; end: string } {
  _slot += 1
  const start = new Date(Date.UTC(2047, 0, 1) + (_slotBase * 40 + _slot) * 5 * 86400000)
  const end = new Date(start.getTime() + 2 * 86400000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { start: fmt(start), end: fmt(end) }
}

async function createUser(points: number): Promise<string> {
  const email = `tdd-cancelrestore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !data.user) throw new Error(`user 생성 실패: ${error?.message}`)
  const uid = data.user.id
  cleanups.push(async () => { await admin.auth.admin.deleteUser(uid) })
  await admin.from('user_profiles').update({ points }).eq('id', uid)
  return uid
}

async function createHold(userId: string): Promise<number> {
  const { start, end } = range()
  const { data, error } = await admin.from('rental_reservations').insert({
    user_id: userId, product_id: productId, start_date: start, end_date: end,
    status: 'hold', pickup_method: 'visit', return_method: 'visit',
  }).select('id').single()
  if (error || !data) throw new Error(`reservation 생성 실패: ${error?.message}`)
  return (data as { id: number }).id
}

interface Fixture { userId: string; reservationIds: number[]; orderId: number; userCouponId: string; couponId: string }

/** 쿠폰 1장(정액 1000) + 포인트 500을 쓰는 주문을 만들고, 결제 확정 시점처럼 쿠폰·포인트를 소진시킨다 */
async function createConsumedOrder(reservations = 1, opts: { consume?: boolean } = {}): Promise<Fixture> {
  const consume = opts.consume ?? true
  const userId = await createUser(2000)
  const code = `TDD_CANCEL_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`
  const { data: coupon, error: cErr } = await admin.from('coupons').insert({
    code, type: 'all', validity_type: 'fixed_period', discount_type: 'fixed', discount_value: 1000,
    allow_stacking: true, allow_with_points: true, is_active: true, min_purchase_amount: 0, min_rental_amount: 0, min_rental_days: 0,
    is_first_rental_only: false, is_student_only: false, is_subscription_only: false, is_walk_in_only: false,
    usage_limit: 1, usage_count: 0, total_usage_limit: null,
  }).select('id').single()
  if (cErr || !coupon) throw new Error(`쿠폰 생성 실패: ${cErr?.message}`)
  const couponId = (coupon as { id: string }).id
  const { data: uc, error: ucErr } = await admin.from('user_coupons').insert({ user_id: userId, coupon_id: couponId, used_count: 0 }).select('id').single()
  if (ucErr || !uc) throw new Error(`user_coupon 생성 실패: ${ucErr?.message}`)
  const userCouponId = (uc as { id: string }).id

  const reservationIds: number[] = []
  for (let i = 0; i < reservations; i++) reservationIds.push(await createHold(userId))

  const { data: orderRows, error: oErr } = await admin.rpc('create_reservation_order', {
    p_user_id: userId, p_reservation_ids: reservationIds, p_selected_points: 500, p_selected_coupon_ids: [userCouponId],
  })
  if (oErr) throw new Error(`create_reservation_order 실패: ${oErr.message}`)
  const orderId = Number((Array.isArray(orderRows) ? orderRows[0] : orderRows)?.order_id)

  cleanups.push(async () => {
    await admin.from('point_transactions').delete().eq('user_id', userId)
    await admin.from('order_coupons').delete().eq('order_id', orderId)
    await admin.from('order_items').delete().eq('order_id', orderId)
    await admin.from('orders').delete().eq('id', orderId)
    await admin.from('rental_reservations').delete().in('id', reservationIds)
    await admin.from('user_coupons').delete().eq('id', userCouponId)
    await admin.from('coupons').delete().eq('id', couponId)
  })

  if (consume) {
    const used = await admin.rpc('use_coupons', { p_user_id: userId, p_order_id: orderId, p_user_coupon_ids: [userCouponId] })
    if (used.error || !(used.data as { ok: boolean }).ok) throw new Error(`쿠폰 소진 실패: ${JSON.stringify(used.error ?? used.data)}`)
    const pts = await admin.rpc('use_points', { p_user_id: userId, p_points: 500, p_order_id: orderId })
    if (!(pts.data as { ok: boolean }).ok) throw new Error(`포인트 차감 실패: ${JSON.stringify(pts.data)}`)
  }
  return { userId, reservationIds, orderId, userCouponId, couponId }
}

async function cancel(rid: number): Promise<void> {
  const { data, error } = await admin.rpc('update_reservation_status', { p_reservation_id: rid, p_new_status: 'cancelled' })
  expect(error).toBeNull()
  expect((data as { ok: boolean } | null)?.ok).toBe(true)
}

async function couponState(f: Fixture) {
  const { data: uc } = await admin.from('user_coupons').select('used_at, used_count, order_id').eq('id', f.userCouponId).single()
  const { data: c } = await admin.from('coupons').select('usage_count').eq('id', f.couponId).single()
  return { uc: uc as { used_at: string | null; used_count: number; order_id: number | null }, usageCount: Number((c as { usage_count: number }).usage_count) }
}
async function balanceOf(userId: string): Promise<number> {
  const { data } = await admin.from('user_profiles').select('points').eq('id', userId).single()
  return Number((data as { points: number }).points)
}
async function refundRows(userId: string): Promise<number> {
  const { count } = await admin.from('point_transactions').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('type', 'refund')
  return count ?? 0
}

describe('주문 전체 취소 시 소진된 쿠폰·포인트 환원', () => {
  it('fixture 전제: 결제 확정처럼 소진되면 쿠폰은 사용됨, 포인트는 500 차감', async () => {
    const f = await createConsumedOrder(1)
    const s = await couponState(f)
    expect(s.uc.used_at).not.toBeNull()
    expect(s.uc.used_count).toBe(1)
    expect(s.uc.order_id).toBe(f.orderId)
    expect(await balanceOf(f.userId)).toBe(1500)
  }, 90000)

  it('RED→GREEN: 단일 예약 주문 취소 → 쿠폰 사용 가능 복귀 + 포인트 500 복원 + 환원 기록 1건', async () => {
    const f = await createConsumedOrder(1)
    const before = await couponState(f)

    await cancel(f.reservationIds[0])

    const s = await couponState(f)
    expect(s.uc.used_at).toBeNull()
    expect(s.uc.used_count).toBe(0)
    expect(s.uc.order_id).toBeNull()
    expect(s.usageCount).toBe(before.usageCount - 1)
    expect(await balanceOf(f.userId)).toBe(2000)
    expect(await refundRows(f.userId)).toBe(1)
  }, 90000)

  it('다건 주문: 일부만 취소하면 되돌리지 않고, 마지막 예약까지 취소되면 한 번에 환원', async () => {
    const f = await createConsumedOrder(2)

    await cancel(f.reservationIds[0])
    expect((await couponState(f)).uc.used_at).not.toBeNull()
    expect(await balanceOf(f.userId)).toBe(1500)
    expect(await refundRows(f.userId)).toBe(0)

    await cancel(f.reservationIds[1])
    expect((await couponState(f)).uc.used_at).toBeNull()
    expect(await balanceOf(f.userId)).toBe(2000)
    expect(await refundRows(f.userId)).toBe(1)
  }, 120000)

  it('멱등: 상태가 다시 바뀌어(취소→만료) 트리거가 또 실행돼도 이중 환원하지 않는다', async () => {
    const f = await createConsumedOrder(1)
    await cancel(f.reservationIds[0])
    expect(await balanceOf(f.userId)).toBe(2000)

    const { error } = await admin.from('rental_reservations').update({ status: 'expired' }).eq('id', f.reservationIds[0])
    expect(error).toBeNull()
    expect(await balanceOf(f.userId)).toBe(2000)
    expect(await refundRows(f.userId)).toBe(1)
    expect((await couponState(f)).usageCount).toBeGreaterThanOrEqual(0)
  }, 90000)

  it('결제 전(아직 소진 안 됨) 주문의 취소는 쿠폰·포인트를 건드리지 않는다', async () => {
    const f = await createConsumedOrder(1, { consume: false })
    const before = await couponState(f)

    await cancel(f.reservationIds[0])

    const s = await couponState(f)
    expect(s.uc.used_at).toBeNull()
    expect(s.uc.used_count).toBe(0)
    expect(s.usageCount).toBe(before.usageCount)
    expect(await balanceOf(f.userId)).toBe(2000)
    expect(await refundRows(f.userId)).toBe(0)
  }, 90000)
})
