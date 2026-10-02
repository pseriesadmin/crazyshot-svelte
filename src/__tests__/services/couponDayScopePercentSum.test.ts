import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { ensure24hPriceRule } from '../helpers/ensure24hPriceRule'

/**
 * 쿠폰 "일자별 정률 합산" — TDD (2026-10-02, Migration #620·#621)
 * Harness Flow v3.2 — RED → GREEN
 *
 * Stephen 확정 정책(service-operations.md §21 개정):
 *   ① 정률 쿠폰 2장 이상은 복리가 아니라 합산 — 같은 기준금액에 각자 계산해 더한다.
 *   ② 정액 먼저: R = 상품합계 − Σ정액. 정률은 R(전 일자 쿠폰) / R1(1일차 한정 쿠폰)에 적용.
 *      R1 = 1일차 기준액 B1 × R / 합계 T (정액은 줄 금액 비례 배분).
 *   ③ "1일차" = 24시간 이상 대여는 첫 24시간(하루 단가), 12시간 이하는 그 12시간 요금 전체. 옵션 요금 포함.
 *   ④ 쿠폰별 할인 = ROUND(기준액 × 율/100) → 한도(max_discount_amount) LEAST → 합계가 R를 넘지 않게 coupon_id 순 절단.
 *
 * 완료기준(B-START):
 *   정상 동작   : 방문 10%(first_day) + 미친할인 30%(order) 2일 대여 → 1일차 40%·2일차 30% = 0.7D (복리 0.74D 아님).
 *   막아야 할 것 : first_day 범위는 percentage 쿠폰에만. 기본값(order)은 기존 쿠폰 전부 하위호환.
 *   실패했을 때  : 고객이 이름("1일차")과 다른 금액을 청구받거나, 화면 금액과 서버 금액이 달라 결제가 막힌다.
 *
 * 주의: Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 — Migration #620·#621 적용 전에는 실패하는 것이 정상.
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

let productId: string
let daily: number
const userIds: string[] = []
const couponIds: string[] = []

const _slotBase = Date.now() % 1000
let _slot = 0
function dayPlus(n: number, base: string): string {
  const d = new Date(`${base}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function freshStart(): string {
  _slot += 1
  const d = new Date(Date.UTC(2044, 0, 1) + (_slotBase * 60 + _slot) * 7 * 86400000)
  return d.toISOString().slice(0, 10)
}

async function newUser(): Promise<string> {
  const email = `tdd-dayscope-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !data.user) throw new Error(`user 생성 실패: ${error?.message}`)
  userIds.push(data.user.id)
  return data.user.id
}

interface CouponSpec { type: 'fixed' | 'percentage' | 'free_shipping'; value: number; max?: number | null; scope?: 'order' | 'first_day' }
async function newCoupon(spec: CouponSpec): Promise<string> {
  const row = {
    code: `TDD_DAYSCOPE_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    type: 'all', validity_type: 'fixed_period', discount_type: spec.type, discount_value: spec.value,
    max_discount_amount: spec.max ?? null, allow_stacking: true, allow_with_points: true, allow_coupon_stacking: true,
    is_active: true, min_purchase_amount: 0, min_rental_amount: 0, min_rental_days: 0,
    is_first_rental_only: false, is_student_only: false, is_subscription_only: false, is_walk_in_only: false,
    usage_limit: 1, usage_count: 0, discount_scope: spec.scope ?? 'order',
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

interface Rental { start: string; end: string; pickup: string; ret: string }
async function newReservation(userId: string, r: Rental): Promise<number> {
  const { data, error } = await admin.from('rental_reservations').insert({
    user_id: userId, product_id: productId, start_date: r.start, end_date: r.end, status: 'hold',
    pickup_method: 'visit', return_method: 'visit', duration_type: '24h', pickup_time: r.pickup, return_time: r.ret,
  }).select('id').single()
  if (error || !data) throw new Error(`예약 생성 실패: ${error?.message}`)
  return (data as { id: number }).id
}

/** 주문 생성(쿠폰 포함) 후 주문·쿠폰별 금액 조회 */
async function placeOrder(userId: string, reservationIds: number[], userCouponIds: string[], deliveryFee = 0) {
  const { data, error } = await admin.rpc('create_reservation_order', {
    p_user_id: userId, p_reservation_ids: reservationIds, p_selected_points: 0, p_delivery_fee: deliveryFee, p_selected_coupon_ids: userCouponIds,
  })
  if (error) throw new Error(`주문 생성 실패: ${error.message}`)
  const orderId = (data as Array<{ order_id: number }>)[0].order_id
  return readOrder(orderId)
}
async function readOrder(orderId: number) {
  const { data: o } = await admin.from('orders').select('total_amount, coupon_discount_amount, final_amount, discount_amount').eq('id', orderId).single()
  const { data: oc } = await admin.from('order_coupons').select('coupon_id, discount_amount').eq('order_id', orderId)
  const byCoupon = new Map(((oc ?? []) as Array<{ coupon_id: string; discount_amount: string | number }>).map(r => [r.coupon_id, Number(r.discount_amount)]))
  const row = o as { total_amount: string; coupon_discount_amount: string; final_amount: string; discount_amount: string }
  return { orderId, total: Number(row.total_amount), couponDiscount: Number(row.coupon_discount_amount), final: Number(row.final_amount), byCoupon }
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

describe('compute_reservation_line_amount — first_day_amount(1일차 기준액)', () => {
  it('2일(48시간) 대여: 1일차 = 하루 단가 1개, 합계 = 2일치', async () => {
    const u = await newUser(); const s = freshStart()
    const rid = await newReservation(u, { start: s, end: dayPlus(2, s), pickup: '10:00', ret: '10:00' })
    const { data, error } = await admin.rpc('compute_reservation_line_amount', { p_reservation_id: rid })
    expect(error).toBeNull()
    const row = (data as Array<{ rental_fee: string; options_fee: string; first_day_amount: string }>)[0]
    expect(Number(row.rental_fee)).toBe(daily * 2)
    expect(Number(row.first_day_amount)).toBe(daily)
  })

  it('12시간 이하 당일 대여: 1일차 = 그 12시간 요금 전체(= 대여요금)', async () => {
    const u = await newUser(); const s = freshStart()
    const rid = await newReservation(u, { start: s, end: s, pickup: '13:30', ret: '22:30' })
    const { data } = await admin.rpc('compute_reservation_line_amount', { p_reservation_id: rid })
    const row = (data as Array<{ rental_fee: string; options_fee: string; first_day_amount: string }>)[0]
    expect(Number(row.first_day_amount)).toBe(Number(row.rental_fee) + Number(row.options_fee))
    expect(Number(row.rental_fee)).toBeGreaterThan(0)
  })

  it('1일차 기준액은 항상 (대여요금+옵션) 이하', async () => {
    const u = await newUser(); const s = freshStart()
    const rid = await newReservation(u, { start: s, end: dayPlus(1, s), pickup: '09:00', ret: '21:00' })
    const { data } = await admin.rpc('compute_reservation_line_amount', { p_reservation_id: rid })
    const row = (data as Array<{ rental_fee: string; options_fee: string; first_day_amount: string }>)[0]
    expect(Number(row.first_day_amount)).toBeLessThanOrEqual(Number(row.rental_fee) + Number(row.options_fee))
  })
})

describe('정률 쿠폰 합산 + 1일차 한정 — create_reservation_order / sync_order_after_composition_change', () => {
  it('핵심: 2일 대여, 30%(전 일자) + 10%(1일차 한정) → 1일차 40%·2일차 30% = 0.7D (복리 0.74D 아님)', async () => {
    const u = await newUser(); const s = freshStart()
    const rid = await newReservation(u, { start: s, end: dayPlus(2, s), pickup: '10:00', ret: '10:00' })
    const c30 = await newCoupon({ type: 'percentage', value: 30 })
    const c10 = await newCoupon({ type: 'percentage', value: 10, scope: 'first_day' })
    const o = await placeOrder(u, [rid], [await giveCoupon(u, c30), await giveCoupon(u, c10)])

    expect(o.total).toBe(daily * 2)
    expect(o.byCoupon.get(c30)).toBe(Math.round(daily * 2 * 0.3))
    expect(o.byCoupon.get(c10)).toBe(Math.round(daily * 0.1))
    expect(o.couponDiscount).toBe(Math.round(daily * 2 * 0.3) + Math.round(daily * 0.1))
    expect(o.final).toBe(o.total - o.couponDiscount)
  })

  it('전 일자 쿠폰 2장(30%+10%)은 복리가 아니라 합산 = 40%', async () => {
    const u = await newUser(); const s = freshStart()
    const rid = await newReservation(u, { start: s, end: dayPlus(2, s), pickup: '10:00', ret: '10:00' })
    const a = await newCoupon({ type: 'percentage', value: 30 })
    const b = await newCoupon({ type: 'percentage', value: 10 })
    const o = await placeOrder(u, [rid], [await giveCoupon(u, a), await giveCoupon(u, b)])
    const base = daily * 2
    expect(o.byCoupon.get(a)).toBe(Math.round(base * 0.3))
    expect(o.byCoupon.get(b)).toBe(Math.round(base * 0.1))
    expect(o.couponDiscount).toBe(Math.round(base * 0.3) + Math.round(base * 0.1))
  })

  it('정액 먼저: 정액 차감 후 R에 정률 — 1일차 한정 기준액은 R×(B1/T)로 비례 배분', async () => {
    const u = await newUser(); const s = freshStart()
    const rid = await newReservation(u, { start: s, end: dayPlus(2, s), pickup: '10:00', ret: '10:00' })
    const fixed = await newCoupon({ type: 'fixed', value: 5000 })
    const c30 = await newCoupon({ type: 'percentage', value: 30 })
    const c10 = await newCoupon({ type: 'percentage', value: 10, scope: 'first_day' })
    const o = await placeOrder(u, [rid], [await giveCoupon(u, fixed), await giveCoupon(u, c30), await giveCoupon(u, c10)])

    const T = daily * 2
    const R = T - 5000
    const R1 = (daily * R) / T
    expect(o.byCoupon.get(fixed)).toBe(5000)
    expect(o.byCoupon.get(c30)).toBe(Math.round(R * 0.3))
    expect(o.byCoupon.get(c10)).toBe(Math.round(R1 * 0.1))
    expect(o.couponDiscount).toBe(5000 + Math.round(R * 0.3) + Math.round(R1 * 0.1))
  })

  it('당일 반일 대여(12시간 이하): 1일차 한정 쿠폰도 요금 전체에 적용 — 30%+10% = 40%', async () => {
    const u = await newUser(); const s = freshStart()
    const rid = await newReservation(u, { start: s, end: s, pickup: '13:30', ret: '22:30' })
    const c30 = await newCoupon({ type: 'percentage', value: 30 })
    const c10 = await newCoupon({ type: 'percentage', value: 10, scope: 'first_day' })
    const o = await placeOrder(u, [rid], [await giveCoupon(u, c30), await giveCoupon(u, c10)])
    expect(o.byCoupon.get(c30)).toBe(Math.round(o.total * 0.3))
    expect(o.byCoupon.get(c10)).toBe(Math.round(o.total * 0.1))
    expect(o.couponDiscount).toBe(Math.round(o.total * 0.3) + Math.round(o.total * 0.1))
  })

  it('정률 한도(max_discount_amount)는 쿠폰별 총 할인액 기준', async () => {
    const u = await newUser(); const s = freshStart()
    const rid = await newReservation(u, { start: s, end: dayPlus(2, s), pickup: '10:00', ret: '10:00' })
    const capped = await newCoupon({ type: 'percentage', value: 50, max: 1000 })
    const o = await placeOrder(u, [rid], [await giveCoupon(u, capped)])
    expect(o.byCoupon.get(capped)).toBe(1000)
    expect(o.couponDiscount).toBe(1000)
  })

  it('정률 합계가 기준액을 넘으면(60%+60%) coupon_id 순으로 절단 — 합계 ≤ R, 결제금액 ≥ 0', async () => {
    const u = await newUser(); const s = freshStart()
    const rid = await newReservation(u, { start: s, end: dayPlus(2, s), pickup: '10:00', ret: '10:00' })
    const a = await newCoupon({ type: 'percentage', value: 60 })
    const b = await newCoupon({ type: 'percentage', value: 60 })
    const o = await placeOrder(u, [rid], [await giveCoupon(u, a), await giveCoupon(u, b)])
    expect(o.couponDiscount).toBeLessThanOrEqual(o.total)
    expect(o.final).toBeGreaterThanOrEqual(0)
    const sum = (o.byCoupon.get(a) ?? 0) + (o.byCoupon.get(b) ?? 0)
    expect(sum).toBe(o.couponDiscount)
  })

  it('구성 변경 재계산(sync)도 같은 규칙 — 주문 생성 직후 sync 호출해도 금액이 변하지 않는다(멱등)', async () => {
    const u = await newUser(); const s = freshStart()
    const rid = await newReservation(u, { start: s, end: dayPlus(2, s), pickup: '10:00', ret: '10:00' })
    const c30 = await newCoupon({ type: 'percentage', value: 30 })
    const c10 = await newCoupon({ type: 'percentage', value: 10, scope: 'first_day' })
    const o = await placeOrder(u, [rid], [await giveCoupon(u, c30), await giveCoupon(u, c10)])
    const { error } = await admin.rpc('sync_order_after_composition_change', { p_order_id: o.orderId })
    expect(error).toBeNull()
    const after = await readOrder(o.orderId)
    expect(after.couponDiscount).toBe(o.couponDiscount)
    expect(after.final).toBe(o.final)
    expect(after.byCoupon.get(c10)).toBe(Math.round(daily * 0.1))
  })

  it('무료배송 쿠폰은 불변 — 배송비 한도 내 차감, 대여요금 정률과 무관', async () => {
    const u = await newUser(); const s = freshStart()
    const rid = await newReservation(u, { start: s, end: dayPlus(2, s), pickup: '10:00', ret: '10:00' })
    const fs = await newCoupon({ type: 'free_shipping', value: 5000 })
    const o = await placeOrder(u, [rid], [await giveCoupon(u, fs)], 3000)
    expect(o.couponDiscount).toBe(3000)
  })
})

describe('coupons.discount_scope 스키마·설정 RPC', () => {
  it('기본값은 order, first_day는 percentage 쿠폰에서만 허용(정액·무료배송은 DB가 거부)', async () => {
    const c = await newCoupon({ type: 'percentage', value: 10 })
    const { data } = await admin.from('coupons').select('discount_scope').eq('id', c).single()
    expect((data as { discount_scope: string }).discount_scope).toBe('order')

    await expect(newCoupon({ type: 'fixed', value: 1000, scope: 'first_day' })).rejects.toThrow()
    await expect(newCoupon({ type: 'free_shipping', value: 1000, scope: 'first_day' })).rejects.toThrow()
  })

  it('cms_set_coupon_discount_scope: percentage 쿠폰의 범위를 first_day ↔ order로 바꾼다', async () => {
    const c = await newCoupon({ type: 'percentage', value: 10 })
    const r1 = await admin.rpc('cms_set_coupon_discount_scope', { p_id: c, p_scope: 'first_day' })
    expect(r1.error).toBeNull()
    expect((await admin.from('coupons').select('discount_scope').eq('id', c).single()).data).toEqual({ discount_scope: 'first_day' })
    const r2 = await admin.rpc('cms_set_coupon_discount_scope', { p_id: c, p_scope: 'order' })
    expect(r2.error).toBeNull()
    expect((await admin.from('coupons').select('discount_scope').eq('id', c).single()).data).toEqual({ discount_scope: 'order' })
  })

  it('cms_set_coupon_discount_scope: 정액 쿠폰은 first_day 불가, 잘못된 값은 거부', async () => {
    const f = await newCoupon({ type: 'fixed', value: 1000 })
    const bad1 = await admin.rpc('cms_set_coupon_discount_scope', { p_id: f, p_scope: 'first_day' })
    expect(bad1.error).not.toBeNull()
    const p = await newCoupon({ type: 'percentage', value: 10 })
    const bad2 = await admin.rpc('cms_set_coupon_discount_scope', { p_id: p, p_scope: 'weekend' })
    expect(bad2.error).not.toBeNull()
  })
})
