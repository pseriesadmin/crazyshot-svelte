import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { ensure24hPriceRule } from '../helpers/ensure24hPriceRule'

/**
 * 휴무일 연장요금은 "총 기본 대여요금(T)"에 합산된다 — 할인 대상 포함 (Migration 626, 2026-10-02 Stephen 확정)
 *
 * 완료기준(B-START):
 *   정상 동작   : T = 기본 대여요금(연장일 차감 후) + 휴무일 연장요금. 멤버십·쿠폰 할인은 이 T 전체에 적용되고,
 *                결제금액 = T − 할인 − 포인트 + 배송비 (연장요금을 따로 더하지 않는다).
 *   막아야 할 것 : 연장요금이 T 밖에서 할인 없이 더해지는 이전 방식으로 되돌아가는 것, create/sync가 서로 다른 값을 내는 것.
 *   실패했을 때  : 고객 화면 금액과 서버 결제금액이 달라 결제가 막히거나 연장요금이 이중으로 청구/누락된다.
 *
 * Stage DB 라이브 — Migration #626 적용 전에는 실패하는 것이 정상.
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

let productId: string
let daily: number
const userIds: string[] = []
const couponIds: string[] = []

const _slotBase = Date.now() % 1000
let _slot = 0
function freshStart(): string {
  _slot += 1
  const d = new Date(Date.UTC(2046, 0, 1) + (_slotBase * 60 + _slot) * 7 * 86400000)
  return d.toISOString().slice(0, 10)
}
function dayPlus(n: number, base: string): string {
  const d = new Date(`${base}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

async function newUser(): Promise<string> {
  const email = `tdd-holidaybase-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !data.user) throw new Error(`user 생성 실패: ${error?.message}`)
  userIds.push(data.user.id)
  return data.user.id
}

async function newCoupon(type: 'fixed' | 'percentage', value: number): Promise<string> {
  const row = {
    code: `TDD_HOLBASE_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    type: 'all', validity_type: 'fixed_period', discount_type: type, discount_value: value,
    max_discount_amount: null, allow_stacking: true, allow_with_points: true, allow_coupon_stacking: true,
    is_active: true, min_purchase_amount: 0, min_rental_amount: 0, min_rental_days: 0,
    is_first_rental_only: false, is_student_only: false, is_subscription_only: false, is_walk_in_only: false,
    usage_limit: 1, usage_count: 0,
  }
  const { data, error } = await admin.from('coupons').insert(row).select('id').single()
  if (error || !data) throw new Error(`쿠폰 생성 실패: ${error?.message}`)
  couponIds.push((data as { id: string }).id)
  return (data as { id: string }).id
}
async function giveCoupon(userId: string, couponId: string): Promise<string> {
  const { data, error } = await admin.from('user_coupons').insert({ user_id: userId, coupon_id: couponId, used_count: 0 }).select('id').single()
  if (error || !data) throw new Error(`user_coupon 생성 실패: ${error?.message}`)
  return (data as { id: string }).id
}

/** 배송 잠금(crazydelivery) 3일 대여 + 수령측 연장 1일 → 기본 2일치(= 3일 − 연장 1일) + 연장요금 daily×0.5 */
async function newExtendedReservation(userId: string): Promise<number> {
  const s = freshStart()
  const { data, error } = await admin.from('rental_reservations').insert({
    user_id: userId, product_id: productId, start_date: s, end_date: dayPlus(2, s), status: 'hold',
    pickup_method: 'crazydelivery', return_method: 'visit', duration_type: '24h', pickup_time: '10:00', return_time: '10:00',
    pickup_holiday_extra_days: 1, return_holiday_extra_days: 0,
  }).select('id').single()
  if (error || !data) throw new Error(`예약 생성 실패: ${error?.message}`)
  return (data as { id: number }).id
}

async function placeOrder(userId: string, reservationIds: number[], userCouponIds: string[] | null, deliveryFee = 0) {
  const { data, error } = await admin.rpc('create_reservation_order', {
    p_user_id: userId, p_reservation_ids: reservationIds, p_selected_points: 0, p_delivery_fee: deliveryFee, p_selected_coupon_ids: userCouponIds,
  })
  if (error) throw new Error(`주문 생성 실패: ${error.message}`)
  const orderId = (data as Array<{ order_id: number }>)[0].order_id
  return { orderId, ...(await readOrder(orderId)) }
}
async function readOrder(orderId: number) {
  const { data: o } = await admin.from('orders').select('total_amount, coupon_discount_amount, final_amount, holiday_extra_fee').eq('id', orderId).single()
  const r = o as { total_amount: string; coupon_discount_amount: string; final_amount: string; holiday_extra_fee: string }
  return { total: Number(r.total_amount), coupon: Number(r.coupon_discount_amount), final: Number(r.final_amount), holiday: Number(r.holiday_extra_fee) }
}

beforeAll(async () => {
  const { data: units, error } = await admin.from('products').select('id').is('parent_product_id', null).eq('is_active', true).limit(1)
  if (error || !units || units.length === 0) throw new Error('테스트용 부모 상품이 없습니다.')
  productId = (units[0] as { id: string }).id
  await ensure24hPriceRule(admin, productId)
  const { data: pr } = await admin.from('price_rules').select('price').eq('product_id', productId).eq('duration_type', '24h').eq('is_active', true).is('deleted_at', null).limit(1).single()
  daily = Number((pr as { price: string | number }).price)
})

afterAll(async () => {
  for (const uid of userIds) {
    const { data: rs } = await admin.from('rental_reservations').select('id').eq('user_id', uid)
    const ids = ((rs ?? []) as Array<{ id: number }>).map(r => r.id)
    if (ids.length > 0) {
      await admin.from('order_items').delete().in('reservation_id', ids)
      await admin.from('rental_reservations').delete().in('id', ids)
    }
    await admin.from('orders').delete().eq('user_id', uid)
    await admin.from('user_coupons').delete().eq('user_id', uid)
    await admin.auth.admin.deleteUser(uid).catch(() => undefined)
  }
  if (couponIds.length > 0) await admin.from('coupons').delete().in('id', couponIds)
})

describe('휴무일 연장요금은 총 기본 대여요금(T)에 합산된다 — 할인 대상 포함', () => {
  it('쿠폰 없음: 총액 = 기본 2일치 + 연장 daily×0.5, 결제금액 = 총액 (따로 더하지 않음)', async () => {
    const u = await newUser()
    const rid = await newExtendedReservation(u)
    const o = await placeOrder(u, [rid], null)
    expect(o.holiday).toBe(daily * 0.5)
    expect(o.total).toBe(daily * 2 + daily * 0.5)
    expect(o.final).toBe(o.total)
  })

  it('정률 10% 쿠폰은 연장요금까지 포함한 총액에 적용된다', async () => {
    const u = await newUser()
    const rid = await newExtendedReservation(u)
    const uc = await giveCoupon(u, await newCoupon('percentage', 10))
    const o = await placeOrder(u, [rid], [uc])
    const total = daily * 2.5
    expect(o.total).toBe(total)
    expect(o.coupon).toBe(Math.round(total * 0.1))
    expect(o.final).toBe(total - Math.round(total * 0.1))
  })

  it('정액 쿠폰 + 배송비: 결제금액 = 총액 − 정액 + 배송비', async () => {
    const u = await newUser()
    const rid = await newExtendedReservation(u)
    const uc = await giveCoupon(u, await newCoupon('fixed', 3000))
    const o = await placeOrder(u, [rid], [uc], 5000)
    expect(o.total).toBe(daily * 2.5)
    expect(o.final).toBe(daily * 2.5 - 3000 + 5000)
  })

  it('sync_order_after_composition_change 재호출해도 create와 같은 값(멱등)', async () => {
    const u = await newUser()
    const rid = await newExtendedReservation(u)
    const uc = await giveCoupon(u, await newCoupon('percentage', 10))
    const o = await placeOrder(u, [rid], [uc])
    const { error } = await admin.rpc('sync_order_after_composition_change', { p_order_id: o.orderId })
    expect(error).toBeNull()
    const after = await readOrder(o.orderId)
    expect(after.total).toBe(o.total)
    expect(after.coupon).toBe(o.coupon)
    expect(after.final).toBe(o.final)
  })
})
