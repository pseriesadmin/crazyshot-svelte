import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ── 정리 대상 ID 추적 ─────────────────────────────────────────────────────
const cleanupUserIds:        string[] = []
const cleanupCouponIds:      string[] = []
const cleanupUserCouponIds:  string[] = []
const cleanupOrderIds:       number[] = []
const cleanupReservationIds: number[] = []

// ── 헬퍼: ephemeral 테스트 사용자 생성 ────────────────────────────────────
async function createTestUser() {
  const email = `test_coupon_rules_${Date.now()}_${Math.random().toString(36).slice(2)}@crazyshot-test.invalid`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'test-password-1234!',
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`사용자 생성 실패: ${error?.message}`)
  cleanupUserIds.push(data.user.id)
  return data.user
}

// ── 헬퍼: 테스트 쿠폰 생성 ─────────────────────────────────────────────────
type CouponSpec = {
  discount_type?: 'fixed' | 'percentage' | 'free_shipping'
  discount_value?: number
  max_discount_amount?: number | null
  allow_stacking?: boolean
  allow_with_points?: boolean
  allow_coupon_stacking?: boolean
}

async function createTestCoupon(spec: CouponSpec = {}) {
  const code = `TEST_RULES_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`
  const row = {
    code,
    type:                 'all',
    validity_type:        'fixed_period',
    discount_type:        spec.discount_type ?? 'fixed',
    discount_value:       spec.discount_value ?? 1000,
    max_discount_amount:  spec.max_discount_amount ?? null,
    allow_stacking:       spec.allow_stacking ?? true,
    allow_with_points:    spec.allow_with_points ?? true,
    allow_coupon_stacking: spec.allow_coupon_stacking ?? true,
    is_active:            true,
    valid_from:           null,
    valid_until:          null,
    min_purchase_amount:  0,
    min_rental_amount:    0,
    min_rental_days:      0,
    is_first_rental_only: false,
    is_student_only:      false,
    is_subscription_only: false,
    is_walk_in_only:      false,
    usage_limit:          1,
    usage_count:          0,
    total_usage_limit:    null,
  }
  const { data, error } = await (admin as unknown as {
    from: (t: string) => { insert: (r: typeof row) => { select: (c: string) => { single: () => Promise<{ data: { id: string } | null; error: unknown }> } } }
  }).from('coupons')
    .insert(row)
    .select('id')
    .single()
  if (error || !data) throw new Error(`쿠폰 생성 실패: ${JSON.stringify(error)}`)
  cleanupCouponIds.push(data.id)
  return data.id
}

// ── 헬퍼: user_coupon 연결 ───────────────────────────────────────────────────
async function createUserCoupon(userId: string, couponId: string, usedAt?: string) {
  const row: Record<string, unknown> = { user_id: userId, coupon_id: couponId, used_count: 0 }
  if (usedAt) row.used_at = usedAt
  const { data, error } = await (admin as unknown as {
    from: (t: string) => { insert: (r: typeof row) => { select: (c: string) => { single: () => Promise<{ data: { id: string } | null; error: unknown }> } } }
  }).from('user_coupons')
    .insert(row)
    .select('id')
    .single()
  if (error || !data) throw new Error(`user_coupon 생성 실패: ${JSON.stringify(error)}`)
  cleanupUserCouponIds.push(data.id)
  return data.id as string
}

// ── 헬퍼: orders 행 INSERT (line_total 합계를 직접 반영하기 위해 order_items도 함께) ──
async function createOrder(userId: string, totalAmount: number, deliveryFee = 0): Promise<number> {
  const orderKey = `TEST-RULES-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
  const { data, error } = await (admin as unknown as {
    from: (t: string) => {
      insert: (r: Record<string, unknown>) => {
        select: (c: string) => { single: () => Promise<{ data: { id: number } | null; error: unknown }> }
      }
    }
  }).from('orders')
    .insert({
      user_id:         userId,
      order_key:       orderKey,
      total_amount:    totalAmount,
      discount_amount: 0,
      tax_amount:      0,
      final_amount:    totalAmount,
      status:          'pending',
      delivery_fee:    deliveryFee,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`order 생성 실패: ${JSON.stringify(error)}`)
  cleanupOrderIds.push(data.id)
  return data.id
}

// ── 헬퍼: rental_reservation INSERT (최소 필드) ──────────────────────────────
async function createReservation(userId: string): Promise<number> {
  const code = `RSV-RULES-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
  const { data, error } = await (admin as unknown as {
    from: (t: string) => {
      insert: (r: Record<string, unknown>) => {
        select: (c: string) => { single: () => Promise<{ data: { id: number } | null; error: unknown }> }
      }
    }
  }).from('rental_reservations')
    .insert({
      user_id:          userId,
      reservation_code: code,
      product_id:       '12361ae3-5bbc-4da8-9fbb-8249241fab65', // Stage DB 활성 자식 상품 (NOT NULL)
      status:           'hold',
      pickup_method:    'visit',
      start_date:       '2026-09-01',
      end_date:         '2026-09-03',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`reservation 생성 실패: ${JSON.stringify(error)}`)
  cleanupReservationIds.push(data.id)
  return data.id
}

// ── 헬퍼: order_items 연결(line_total을 직접 지정 — otSubtotal 시뮬레이션) ──────
async function createOrderItem(orderId: number, reservationId: number, lineTotal: number) {
  const { error } = await (admin as unknown as {
    from: (t: string) => { insert: (r: Record<string, unknown>) => Promise<{ error: unknown }> }
  }).from('order_items')
    .insert({
      order_id:       orderId,
      reservation_id: reservationId,
      product_id:     '12361ae3-5bbc-4da8-9fbb-8249241fab65',
      quantity:       1,
      unit_price:     lineTotal,
      line_total:     lineTotal,
    })
  if (error) throw new Error(`order_item 생성 실패: ${JSON.stringify(error)}`)
}

// ── 헬퍼: 주문 하나 + line_total 합계를 orderTotal로 맞춰 셋업 ─────────────────
async function setupOrderWithSubtotal(userId: string, subtotal: number, deliveryFee = 0): Promise<number> {
  const orderId = await createOrder(userId, subtotal, deliveryFee)
  const reservationId = await createReservation(userId)
  await createOrderItem(orderId, reservationId, subtotal)
  return orderId
}


// ── RPC 헬퍼 ──────────────────────────────────────────────────────────────────
type RpcRes<T> = Promise<{ data: T | null; error: { message: string } | null }>
const rpc = <T,>(fn: string, args: Record<string, unknown>): RpcRes<T> =>
  (admin.rpc as unknown as (f: string, a: Record<string, unknown>) => RpcRes<T>)(fn, args)

async function usedAt(ucId: string): Promise<string | null> {
  const { data } = await (admin as unknown as {
    from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { used_at: string | null } | null }> } } }
  }).from('user_coupons').select('used_at').eq('id', ucId).maybeSingle()
  return data?.used_at ?? null
}
async function usageCount(couponId: string): Promise<number> {
  const { data } = await (admin as unknown as {
    from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { usage_count: number } | null }> } } }
  }).from('coupons').select('usage_count').eq('id', couponId).maybeSingle()
  return data?.usage_count ?? 0
}
async function orderCouponCount(orderId: number): Promise<number> {
  const { data } = await (admin as unknown as {
    from: (t: string) => { select: (c: string) => { eq: (k: string, v: number) => Promise<{ data: unknown[] | null }> } }
  }).from('order_coupons').select('id').eq('order_id', orderId)
  return data?.length ?? 0
}

afterEach(async () => {
  const del = async (table: string, col: string, ids: Array<string | number>) => {
    if (ids.length === 0) return
    await (admin as unknown as { from: (t: string) => { delete: () => { in: (c: string, v: Array<string | number>) => Promise<unknown> } } })
      .from(table).delete().in(col, ids)
  }
  // FK 의존 순서: order_coupons → user_coupons → order_items → orders → reservations → coupons → users
  await del('order_coupons', 'order_id', cleanupOrderIds)
  await del('user_coupons', 'id', cleanupUserCouponIds)
  await del('order_items', 'order_id', cleanupOrderIds)
  await del('orders', 'id', cleanupOrderIds)
  await del('rental_reservations', 'id', cleanupReservationIds)
  await del('coupons', 'id', cleanupCouponIds)
  for (const id of cleanupUserIds) await admin.auth.admin.deleteUser(id).catch(() => undefined)
  cleanupUserIds.length = 0; cleanupCouponIds.length = 0; cleanupUserCouponIds.length = 0
  cleanupOrderIds.length = 0; cleanupReservationIds.length = 0
})

/**
 * 쿠폰 다중 선택 규칙 — Migration 605 (Stage 라이브 통합 테스트)
 *   SR-1: use_coupons — "쿠폰끼리 중복 허용"이 꺼진 쿠폰이 2장 선택에 섞이면 all-or-nothing 거부(아무것도 소진되지 않음)
 *   SR-2: 단독 선택은 중복 불가 쿠폰이어도 허용
 *   SR-3: validate_order_coupons — 통과 시 사용 처리·usage_count 부작용 없음(프로브 롤백)
 *   SR-4: validate_order_coupons — 중복 불가 쿠폰 혼합·이미 사용된 쿠폰을 사유와 함께 돌려줌
 */
describe('쿠폰끼리 중복 허용(allow_coupon_stacking) 규칙 — Migration 605', () => {
  it('SR-1: 중복 불가 쿠폰이 섞인 2장 선택은 use_coupons가 거부하고 아무것도 소진하지 않는다', async () => {
    const user = await createTestUser()
    const orderId = await setupOrderWithSubtotal(user.id, 100000)
    const cA = await createTestCoupon({ allow_coupon_stacking: false })
    const cB = await createTestCoupon({ allow_coupon_stacking: true })
    const ucA = await createUserCoupon(user.id, cA)
    const ucB = await createUserCoupon(user.id, cB)

    const { error } = await rpc('use_coupons', { p_user_id: user.id, p_order_id: orderId, p_user_coupon_ids: [ucA, ucB] })
    expect(error?.message ?? '').toContain('COUPON_STACKING_NOT_ALLOWED')
    expect(await usedAt(ucA)).toBeNull()
    expect(await usedAt(ucB)).toBeNull()
    expect(await orderCouponCount(orderId)).toBe(0)
  })

  it('SR-2: 중복 불가 쿠폰도 단독으로는 사용할 수 있다', async () => {
    const user = await createTestUser()
    const orderId = await setupOrderWithSubtotal(user.id, 100000)
    const cA = await createTestCoupon({ allow_coupon_stacking: false })
    const ucA = await createUserCoupon(user.id, cA)
    const { data, error } = await rpc<{ ok: boolean }>('use_coupons', { p_user_id: user.id, p_order_id: orderId, p_user_coupon_ids: [ucA] })
    expect(error).toBeNull()
    expect(data?.ok).toBe(true)
    expect(await usedAt(ucA)).not.toBeNull()
  })

  it('SR-3: validate_order_coupons는 통과해도 쿠폰을 소진하지 않는다(부작용 없음)', async () => {
    const user = await createTestUser()
    const orderId = await setupOrderWithSubtotal(user.id, 100000)
    const cA = await createTestCoupon()
    const cB = await createTestCoupon()
    const ucA = await createUserCoupon(user.id, cA)
    const ucB = await createUserCoupon(user.id, cB)
    const before = await usageCount(cA)

    const { data, error } = await rpc<{ ok: boolean; results: Array<{ ok: boolean }> }>('validate_order_coupons', {
      p_user_id: user.id, p_order_id: orderId, p_user_coupon_ids: [ucA, ucB],
    })
    expect(error).toBeNull()
    expect(data?.ok).toBe(true)
    expect(data?.results.every((r) => r.ok)).toBe(true)
    expect(await usedAt(ucA)).toBeNull()
    expect(await usedAt(ucB)).toBeNull()
    expect(await usageCount(cA)).toBe(before)
  })

  it('SR-4: validate_order_coupons는 중복 불가 혼합·이미 사용된 쿠폰을 사유와 함께 돌려준다', async () => {
    const user = await createTestUser()
    const orderId = await setupOrderWithSubtotal(user.id, 100000)
    const cA = await createTestCoupon({ allow_coupon_stacking: false })
    const cB = await createTestCoupon()
    const cC = await createTestCoupon()
    const ucA = await createUserCoupon(user.id, cA)
    const ucB = await createUserCoupon(user.id, cB)
    const ucC = await createUserCoupon(user.id, cC, new Date().toISOString())

    const { data } = await rpc<{ ok: boolean; results: Array<{ user_coupon_id: string; ok: boolean; error: string | null }> }>('validate_order_coupons', {
      p_user_id: user.id, p_order_id: orderId, p_user_coupon_ids: [ucA, ucB, ucC],
    })
    expect(data?.ok).toBe(false)
    const by = new Map((data?.results ?? []).map((r) => [r.user_coupon_id, r]))
    expect(by.get(ucA)?.error).toBe('COUPON_STACKING_NOT_ALLOWED')
    expect(by.get(ucB)?.ok).toBe(true)
    expect(by.get(ucC)?.error).toBe('ALREADY_USED')
  })
})
