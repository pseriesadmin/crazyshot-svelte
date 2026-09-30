import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { calcEarnBase, calcEarnPoints, allocatePoolByCumulativeRounding } from '$lib/utils/cartEarnPoints'

/**
 * 렌탈완료 적립 A-1 — 적립 기준을 "할인·포인트 차감 후 대여료(휴무일 연장요금 포함)"로 재정의(Migration #606).
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트 — 임시(ephemeral) 행을 만들고 종료 시 정리한다.
 * TS 순수 함수(cartEarnPoints.ts: 장바구니 표시)와 SQL(award_rental_complete_points)이 같은 값을 내는지 패리티도 고정한다.
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

async function createUser(): Promise<string> {
  const email = `tdd-netbase-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !data.user) throw new Error(`user 생성 실패: ${error?.message}`)
  const id = data.user.id
  cleanups.push(async () => { await admin.auth.admin.deleteUser(id).catch(() => undefined) })
  return id
}

// 예약 겹침 제약(exclusion)을 피하려고 예약마다 서로 다른 자식 상품을 쓴다
async function pickChildProducts(n: number): Promise<string[]> {
  const { data, error } = await admin.from('products').select('id').not('parent_product_id', 'is', null).eq('is_active', true).limit(n + 10)
  if (error || !data || data.length < n) throw new Error(`자식 상품 부족: ${error?.message}`)
  return data.slice(0, n).map((r) => r.id as string)
}

async function getRate(): Promise<number> {
  const { data } = await admin.from('point_earn_rules').select('rate, is_active').eq('event_type', 'rental_complete').maybeSingle()
  if (!data || data.is_active !== true) throw new Error('rental_complete 규칙이 없거나 비활성 — 테스트 불가')
  return Number(data.rate)
}

interface OrderSpec {
  membership?: number
  coupon?: number
  delivery?: number
  points?: number
  selectedCouponId?: string
}

async function createOrder(userId: string, spec: OrderSpec): Promise<number> {
  const { data, error } = await admin.from('orders').insert({
    order_key: `TDD-NB-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    user_id: userId,
    total_amount: 0,
    final_amount: 0,
    discount_amount: spec.membership ?? 0,
    coupon_discount_amount: spec.coupon ?? 0,
    delivery_fee: spec.delivery ?? 0,
    selected_coupon_id: spec.selectedCouponId ?? null,
  }).select('id').single()
  if (error || !data) throw new Error(`order 생성 실패: ${error?.message}`)
  const orderId = data.id as number
  cleanups.push(async () => { await admin.from('orders').delete().eq('id', orderId) })
  if (spec.points && spec.points > 0) {
    const { error: pErr } = await admin.from('point_transactions').insert({
      user_id: userId, type: 'use', amount: -spec.points, balance_after: 0,
      description: 'TDD 포인트 사용', ref_type: 'order', ref_id: String(orderId),
    })
    if (pErr) throw new Error(`포인트 사용 행 생성 실패: ${pErr.message}`)
    cleanups.push(async () => { await admin.from('point_transactions').delete().eq('user_id', userId) })
  }
  return orderId
}

async function addReservation(
  userId: string, orderId: number, productId: string, lineTotal: number,
  opts: { duration?: string; dayOffset?: number; holidayExtraDays?: number } = {},
): Promise<number> {
  const day = 1 + (opts.dayOffset ?? 0) * 5
  const { data: rr, error } = await admin.from('rental_reservations').insert({
    user_id: userId,
    product_id: productId,
    start_date: `2099-03-${String(day).padStart(2, '0')}`,
    end_date: `2099-03-${String(day + 2).padStart(2, '0')}`,
    status: 'returned',
    pickup_method: 'visit',
    return_method: 'visit',
    ...(opts.duration ? { duration_type: opts.duration } : {}),
    ...(opts.holidayExtraDays ? { pickup_holiday_extra_days: opts.holidayExtraDays } : {}),
  }).select('id').single()
  if (error || !rr) throw new Error(`reservation 생성 실패: ${error?.message}`)
  const rid = rr.id as number
  cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', rid) })
  const { error: iErr } = await admin.from('order_items').insert({
    order_id: orderId, reservation_id: rid, product_id: productId, quantity: 1, unit_price: lineTotal, line_total: lineTotal,
  })
  if (iErr) throw new Error(`order_item 생성 실패: ${iErr.message}`)
  cleanups.push(async () => { await admin.from('order_items').delete().eq('reservation_id', rid) })
  return rid
}

async function award(rid: number) {
  const { data, error } = await admin.rpc('award_rental_complete_points', { p_reservation_id: rid })
  if (error) throw new Error(`RPC 실패: ${error.message}`)
  return data as { success: boolean; error?: string; amount?: number; common_amount?: number; bonus_amount?: number; base_amount?: number }
}

describe('award_rental_complete_points — A-1 차감 후 기준금액(Migration 606)', () => {
  it('할인·포인트 없음 → 대여료 × 적립률 (회귀 없음)', async () => {
    const rate = await getRate()
    const user = await createUser()
    const [p1] = await pickChildProducts(1)
    const order = await createOrder(user, {})
    const rid = await addReservation(user, order, p1, 360000)
    const r = await award(rid)
    expect(r.success).toBe(true)
    expect(r.base_amount).toBe(360000)
    expect(r.common_amount).toBe(calcEarnPoints(360000, rate))
  })

  it('멤버십 할인·쿠폰·사용 포인트를 차감한 금액으로 적립 (장바구니 TS 계산과 동일)', async () => {
    const rate = await getRate()
    const user = await createUser()
    const [p1] = await pickChildProducts(1)
    const order = await createOrder(user, { membership: 36000, coupon: 5000, points: 10000 })
    const rid = await addReservation(user, order, p1, 360000)
    const r = await award(rid)
    const expectedBase = calcEarnBase({
      rentalAmount: 360000, holidayFee: 0, allAmount: 360000, allHolidayFee: 0,
      membershipDiscount: 36000, couponDiscount: 5000, freeShippingDiscount: 0, pointsUsed: 10000,
    })
    expect(expectedBase).toBe(309000)
    expect(r.base_amount).toBe(expectedBase)
    expect(r.common_amount).toBe(calcEarnPoints(expectedBase, rate))
  })

  it('배송비에 적용된 무료배송 쿠폰 할인분은 기준금액에서 빼지 않는다(단일 선택 쿠폰 경로)', async () => {
    const user = await createUser()
    const [p1] = await pickChildProducts(1)
    const code = `TEST_NB_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`
    const { data: c, error: cErr } = await admin.from('coupons').insert({
      code, type: 'all', validity_type: 'fixed_period', discount_type: 'free_shipping', discount_value: 3000,
      allow_stacking: true, allow_with_points: true, allow_coupon_stacking: true, is_active: true,
      min_purchase_amount: 0, min_rental_amount: 0, min_rental_days: 0, usage_limit: 1, usage_count: 0,
    }).select('id').single()
    if (cErr || !c) throw new Error(`쿠폰 생성 실패: ${cErr?.message}`)
    cleanups.push(async () => { await admin.from('coupons').delete().eq('id', c.id) })
    const { data: uc, error: ucErr } = await admin.from('user_coupons').insert({ user_id: user, coupon_id: c.id, used_count: 0 }).select('id').single()
    if (ucErr || !uc) throw new Error(`user_coupon 생성 실패: ${ucErr?.message}`)
    cleanups.push(async () => { await admin.from('user_coupons').delete().eq('id', uc.id) })

    // 쿠폰 할인 3,000원은 전부 배송비 무료분 → 상품분 차감 0
    const order = await createOrder(user, { coupon: 3000, delivery: 6600, selectedCouponId: uc.id as string })
    const rid = await addReservation(user, order, p1, 100000)
    const r = await award(rid)
    expect(r.base_amount).toBe(100000)
  })

  it('구매(판매전용) 라인이 섞인 주문 — 대여 예약은 자기 몫만 차감, 구매 예약은 적립 제외', async () => {
    const user = await createUser()
    const [p1, p2] = await pickChildProducts(2)
    const order = await createOrder(user, { coupon: 10000 })
    const rental = await addReservation(user, order, p1, 300000)
    const purchase = await addReservation(user, order, p2, 100000, { duration: 'purchase', dayOffset: 1 })
    const pr = await award(purchase)
    expect(pr.success).toBe(false)
    expect(pr.error).toBe('purchase_excluded')
    const r = await award(rental)
    expect(r.base_amount).toBe(calcEarnBase({
      rentalAmount: 300000, holidayFee: 0, allAmount: 400000, allHolidayFee: 0,
      membershipDiscount: 0, couponDiscount: 10000, freeShippingDiscount: 0, pointsUsed: 0,
    }))
    expect(r.base_amount).toBe(292500)
  })

  it('한 주문의 두 대여 예약 — 예약별 몫의 합이 풀과 정확히 같다(누적 반올림, TS와 동일)', async () => {
    const user = await createUser()
    const [p1, p2, p3] = await pickChildProducts(3)
    const order = await createOrder(user, { coupon: 10000 })
    const r1 = await addReservation(user, order, p1, 100000)
    const r2 = await addReservation(user, order, p2, 100000, { dayOffset: 1 })
    const r3 = await addReservation(user, order, p3, 100000, { dayOffset: 2 })
    const ids = [r1, r2, r3].sort((a, b) => a - b)
    const alloc = allocatePoolByCumulativeRounding([100000, 100000, 100000], 10000)
    expect(alloc.reduce((s, x) => s + x, 0)).toBe(10000)
    const bases: number[] = []
    for (const id of ids) bases.push((await award(id)).base_amount as number)
    expect(bases).toEqual(alloc.map((a) => 100000 - a))
    expect(bases.reduce((s, x) => s + x, 0)).toBe(300000 - 10000)
  })

  it('기준금액이 0 이하이면 0p(zero_amount)', async () => {
    const user = await createUser()
    const [p1] = await pickChildProducts(1)
    const order = await createOrder(user, { coupon: 50000, points: 60000 })
    const rid = await addReservation(user, order, p1, 100000)
    const r = await award(rid)
    expect(r.success).toBe(false)
    expect(r.error).toBe('zero_amount')
    expect(r.base_amount).toBe(0)
  })

  it('휴무일 연장요금이 있으면 기준금액에 더해진다(서버 compute_reservation_line_amount 값 기준)', async () => {
    const user = await createUser()
    const [p1] = await pickChildProducts(1)
    const order = await createOrder(user, {})
    const rid = await addReservation(user, order, p1, 100000, { holidayExtraDays: 2 })
    const { data: line } = await admin.rpc('compute_reservation_line_amount', { p_reservation_id: rid })
    const hol = Number((Array.isArray(line) ? line[0] : line)?.holiday_extra_fee ?? 0)
    expect(hol).toBeGreaterThan(0) // 테스트가 0=0으로 무의미하게 통과하지 않도록
    const r = await award(rid)
    expect(r.base_amount).toBe(100000 + hol)
  })

  it('멱등 — 같은 예약을 두 번 호출해도 한 번만 지급', async () => {
    const user = await createUser()
    const [p1] = await pickChildProducts(1)
    const order = await createOrder(user, {})
    const rid = await addReservation(user, order, p1, 100000)
    const first = await award(rid)
    const second = await award(rid) as { already_granted?: boolean }
    expect(first.success).toBe(true)
    expect(second.already_granted).toBe(true)
  })
})
