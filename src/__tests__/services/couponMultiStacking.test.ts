/**
 * TDD-RED: couponMultiStacking.test.ts
 * 쿠폰 다중중첩 체크아웃 구조 전환 — Phase 1 of 6
 * (.claude/harness/TASK.md 마스터플랜 / ancient-pondering-salamander.md Phase 1)
 *
 * 이 테스트는 Migration 531~534(order_coupons 테이블 + use_coupons RPC +
 * create_reservation_order/sync_order_after_composition_change 다중쿠폰 지원) 적용 전에는
 * RED(테이블/RPC 부재로 전부 실패)여야 하고, 적용 후에는 전부 GREEN이어야 한다.
 *
 * 테스트 전략: couponEligibilityValidation.test.ts와 동일한 Stage DB
 * (ezyvffjvuwmtuhpxdjrw) 라이브 연동 방식 — ephemeral 사용자·쿠폰·주문·예약을 만들고
 * afterEach에서 정리한다.
 *
 * 검증 항목(§할인계산정책, service-operations.md §1 Phase 1 확정안):
 *   EC-1: fixed 쿠폰 2장 동시 사용 → 둘 다 소진 + order_coupons 2행 + 합산 할인 정확
 *   EC-2: fixed + percentage 혼합 → percentage는 fixed 차감 후 잔액 기준으로 계산됨
 *         (쿠폰별 독립 합산이 아님을 증명 — 독립 합산이면 다른 숫자가 나옴)
 *   EC-3: percentage 쿠폰 2장 → coupon_id 오름차순 순차 적용(각 단계 잔액 갱신)
 *   EC-4: 하나가 부적격(이미 사용됨)이면 all-or-nothing 롤백 — 나머지 하나도 소진되지 않음
 *   EC-5: free_shipping 쿠폰 여러 장의 합계가 배송비를 초과해도 배송비 한도로만 캡핑
 */

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
  const email = `test_coupon_stack_${Date.now()}_${Math.random().toString(36).slice(2)}@crazyshot-test.invalid`
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
}

async function createTestCoupon(spec: CouponSpec = {}) {
  const code = `TEST_STACK_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`
  const row = {
    code,
    type:                 'all',
    validity_type:        'fixed_period',
    discount_type:        spec.discount_type ?? 'fixed',
    discount_value:       spec.discount_value ?? 1000,
    max_discount_amount:  spec.max_discount_amount ?? null,
    allow_stacking:       spec.allow_stacking ?? true,
    allow_with_points:    spec.allow_with_points ?? true,
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
  const orderKey = `TEST-STACK-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
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
  const code = `RSV-STACK-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
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

// ── use_coupons / order_coupons 조회 헬퍼 ─────────────────────────────────────
type UseCouponsResult = { ok: boolean; results?: { user_coupon_id: string; ok: boolean; redeemed_code?: string | null }[] }

async function useCoupons(userId: string, orderId: number, userCouponIds: string[]) {
  return admin.rpc('use_coupons', {
    p_user_id: userId,
    p_order_id: orderId,
    p_user_coupon_ids: userCouponIds,
  }) as unknown as Promise<{ data: UseCouponsResult | null; error: { message: string } | null }>
}

async function getOrderCoupons(orderId: number) {
  const { data, error } = await (admin as unknown as {
    from: (t: string) => {
      select: (c: string) => { eq: (k: string, v: number) => Promise<{ data: { user_coupon_id: string; coupon_id: string; discount_amount: number }[] | null; error: unknown }> }
    }
  }).from('order_coupons')
    .select('user_coupon_id, coupon_id, discount_amount')
    .eq('order_id', orderId)
  if (error) throw new Error(`order_coupons 조회 실패: ${JSON.stringify(error)}`)
  return data ?? []
}

async function getOrderRow(orderId: number) {
  const { data, error } = await (admin as unknown as {
    from: (t: string) => {
      select: (c: string) => { eq: (k: string, v: number) => { maybeSingle: () => Promise<{ data: { coupon_discount_amount: number; final_amount: number } | null; error: unknown }> } }
    }
  }).from('orders')
    .select('coupon_discount_amount, final_amount')
    .eq('id', orderId)
    .maybeSingle()
  if (error) throw new Error(`orders 조회 실패: ${JSON.stringify(error)}`)
  return data
}

async function getUserCouponUsedAt(userCouponId: string): Promise<string | null> {
  const { data, error } = await (admin as unknown as {
    from: (t: string) => {
      select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { used_at: string | null } | null; error: unknown }> } }
    }
  }).from('user_coupons')
    .select('used_at')
    .eq('id', userCouponId)
    .maybeSingle()
  if (error) throw new Error(`user_coupons 조회 실패: ${JSON.stringify(error)}`)
  return data?.used_at ?? null
}

// ── 정리 ──────────────────────────────────────────────────────────────────────
afterEach(async () => {
  // ⚠️ FK 의존 순서: order_coupons(orders·user_coupons 둘 다 참조) → user_coupons
  // (order_id로 orders 참조) → order_items(orders 참조) → orders. 이 순서를 지키지
  // 않으면 "still referenced from table ..." FK 위반으로 정리가 중간에 예외를 던지고,
  // 그 여파로 이후 정리 단계(reservation 삭제 등)까지 통째로 스킵돼 다음 테스트가
  // 날짜충돌로 연쇄 실패한다.
  if (cleanupOrderIds.length > 0) {
    const { error: ocError } = await (admin as unknown as { from: (t: string) => { delete: () => { in: (k: string, v: number[]) => Promise<{ error: unknown }> } } })
      .from('order_coupons').delete().in('order_id', cleanupOrderIds)
    if (ocError) throw new Error(`cleanup order_coupons 실패: ${JSON.stringify(ocError)}`)
  }
  if (cleanupUserCouponIds.length > 0) {
    const { error } = await (admin as unknown as { from: (t: string) => { delete: () => { in: (k: string, v: string[]) => Promise<{ error: unknown }> } } })
      .from('user_coupons').delete().in('id', cleanupUserCouponIds)
    if (error) throw new Error(`cleanup user_coupons 실패: ${JSON.stringify(error)}`)
    cleanupUserCouponIds.length = 0
  }
  if (cleanupOrderIds.length > 0) {
    const { error: oiError } = await (admin as unknown as { from: (t: string) => { delete: () => { in: (k: string, v: number[]) => Promise<{ error: unknown }> } } })
      .from('order_items').delete().in('order_id', cleanupOrderIds)
    if (oiError) throw new Error(`cleanup order_items 실패: ${JSON.stringify(oiError)}`)
    const { error } = await (admin as unknown as { from: (t: string) => { delete: () => { in: (k: string, v: number[]) => Promise<{ error: unknown }> } } })
      .from('orders').delete().in('id', cleanupOrderIds)
    if (error) throw new Error(`cleanup orders 실패: ${JSON.stringify(error)}`)
    cleanupOrderIds.length = 0
  }
  if (cleanupCouponIds.length > 0) {
    const { error } = await (admin as unknown as { from: (t: string) => { delete: () => { in: (k: string, v: string[]) => Promise<{ error: unknown }> } } })
      .from('coupons').delete().in('id', cleanupCouponIds)
    if (error) throw new Error(`cleanup coupons 실패: ${JSON.stringify(error)}`)
    cleanupCouponIds.length = 0
  }
  if (cleanupReservationIds.length > 0) {
    const { error } = await (admin as unknown as { from: (t: string) => { delete: () => { in: (k: string, v: number[]) => Promise<{ error: unknown }> } } })
      .from('rental_reservations').delete().in('id', cleanupReservationIds)
    if (error) throw new Error(`cleanup rental_reservations 실패: ${JSON.stringify(error)}`)
    cleanupReservationIds.length = 0
  }
  if (cleanupUserIds.length > 0) {
    for (const id of cleanupUserIds) {
      await admin.auth.admin.deleteUser(id)
    }
    cleanupUserIds.length = 0
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 테스트 케이스
// ─────────────────────────────────────────────────────────────────────────────

describe('쿠폰 다중중첩 체크아웃 — use_coupons/order_coupons (TDD-RED: Migration 531~534 적용 전 실패해야 함)', () => {

  // ── EC-1: fixed 쿠폰 2장 동시 사용 → 둘 다 소진 + order_coupons 2행 + 합산 정확 ──
  it('EC-1: fixed 2장 동시 사용 → 둘 다 소진되고 order_coupons 2행 생성 + 합산 할인 정확', async () => {
    const user = await createTestUser()
    const orderId = await setupOrderWithSubtotal(user.id, 100000)

    const couponA = await createTestCoupon({ discount_type: 'fixed', discount_value: 1000 })
    const couponB = await createTestCoupon({ discount_type: 'fixed', discount_value: 2000 })
    const ucA = await createUserCoupon(user.id, couponA)
    const ucB = await createUserCoupon(user.id, couponB)

    const { data, error } = await useCoupons(user.id, orderId, [ucA, ucB])
    expect(error).toBeNull()
    expect(data?.ok).toBe(true)
    expect(data?.results?.length).toBe(2)

    // 둘 다 실제로 소진됨
    expect(await getUserCouponUsedAt(ucA)).not.toBeNull()
    expect(await getUserCouponUsedAt(ucB)).not.toBeNull()

    const rows = await getOrderCoupons(orderId)
    expect(rows.length).toBe(2)
    const sumDiscount = rows.reduce((s, r) => s + Number(r.discount_amount), 0)
    expect(sumDiscount).toBe(3000)

    const order = await getOrderRow(orderId)
    expect(Number(order?.coupon_discount_amount)).toBe(3000)
  }, 30000)

  // ── EC-2: fixed + percentage 혼합 — percentage는 fixed 차감 후 잔액 기준 ──
  it('EC-2: fixed(10000) + percentage(10%) 혼합 → percentage는 (100000-10000)*10%=9000 (독립합산이면 10000)', async () => {
    const user = await createTestUser()
    const orderId = await setupOrderWithSubtotal(user.id, 100000)

    const couponFixed = await createTestCoupon({ discount_type: 'fixed', discount_value: 10000 })
    const couponPct   = await createTestCoupon({ discount_type: 'percentage', discount_value: 10 })
    const ucFixed = await createUserCoupon(user.id, couponFixed)
    const ucPct   = await createUserCoupon(user.id, couponPct)

    const { data, error } = await useCoupons(user.id, orderId, [ucFixed, ucPct])
    expect(error).toBeNull()
    expect(data?.ok).toBe(true)

    const rows = await getOrderCoupons(orderId)
    const fixedRow = rows.find((r) => r.user_coupon_id === ucFixed)
    const pctRow   = rows.find((r) => r.user_coupon_id === ucPct)
    expect(Number(fixedRow?.discount_amount)).toBe(10000)
    // 순차 산식: R1 = 100000-10000 = 90000, discount = round(90000*10/100) = 9000
    expect(Number(pctRow?.discount_amount)).toBe(9000)

    const order = await getOrderRow(orderId)
    expect(Number(order?.coupon_discount_amount)).toBe(19000)
  }, 30000)

  // ── EC-3: percentage 쿠폰 2장 — coupon_id 오름차순 순차 적용(대칭 50%+50%로 순서 무관 검증) ──
  it('EC-3: percentage 50%+50% 순차 적용 → 100000*50%=50000, 남은 50000*50%=25000 (합계 75000, 독립합산이면 100000)', async () => {
    const user = await createTestUser()
    const orderId = await setupOrderWithSubtotal(user.id, 100000)

    const couponP1 = await createTestCoupon({ discount_type: 'percentage', discount_value: 50 })
    const couponP2 = await createTestCoupon({ discount_type: 'percentage', discount_value: 50 })
    const ucP1 = await createUserCoupon(user.id, couponP1)
    const ucP2 = await createUserCoupon(user.id, couponP2)

    const { data, error } = await useCoupons(user.id, orderId, [ucP1, ucP2])
    expect(error).toBeNull()
    expect(data?.ok).toBe(true)

    const rows = await getOrderCoupons(orderId)
    const sumDiscount = rows.reduce((s, r) => s + Number(r.discount_amount), 0)
    expect(sumDiscount).toBe(75000) // 순차 적용 특성상 대칭이어도 100000이 아니라 75000

    const order = await getOrderRow(orderId)
    expect(Number(order?.coupon_discount_amount)).toBe(75000)
  }, 30000)

  // ── EC-4: all-or-nothing — 하나가 이미 사용된 쿠폰이면 나머지도 소진되지 않음 ──
  it('EC-4: 하나가 이미 사용됨(ALREADY_USED) → 전체 롤백, 나머지 쿠폰도 소진되지 않음', async () => {
    const user = await createTestUser()
    const orderId = await setupOrderWithSubtotal(user.id, 100000)

    const couponOk      = await createTestCoupon({ discount_type: 'fixed', discount_value: 1000 })
    const couponUsedUp  = await createTestCoupon({ discount_type: 'fixed', discount_value: 2000 })
    const ucOk   = await createUserCoupon(user.id, couponOk)
    const ucUsed = await createUserCoupon(user.id, couponUsedUp, new Date().toISOString()) // 이미 사용됨

    const { error } = await useCoupons(user.id, orderId, [ucOk, ucUsed])
    // all-or-nothing: RAISE EXCEPTION → PostgREST가 에러로 반환
    expect(error).not.toBeNull()

    // 정상 쿠폰도 소진되지 않아야 함(전체 롤백)
    expect(await getUserCouponUsedAt(ucOk)).toBeNull()

    const rows = await getOrderCoupons(orderId)
    expect(rows.length).toBe(0)
  }, 30000)

  // ── EC-5: free_shipping 여러 장 합계가 배송비를 초과해도 배송비 한도로만 캡핑 ──
  it('EC-5: free_shipping 2장(3000+4000=7000) + delivery_fee=5000 → 배송비 한도 5000으로 캡핑', async () => {
    const user = await createTestUser()
    const orderId = await setupOrderWithSubtotal(user.id, 100000, 5000)

    const couponFs1 = await createTestCoupon({ discount_type: 'free_shipping', discount_value: 3000 })
    const couponFs2 = await createTestCoupon({ discount_type: 'free_shipping', discount_value: 4000 })
    const ucFs1 = await createUserCoupon(user.id, couponFs1)
    const ucFs2 = await createUserCoupon(user.id, couponFs2)

    const { data, error } = await useCoupons(user.id, orderId, [ucFs1, ucFs2])
    expect(error).toBeNull()
    expect(data?.ok).toBe(true)

    const order = await getOrderRow(orderId)
    expect(Number(order?.coupon_discount_amount)).toBe(5000) // min(7000, 5000)
  }, 30000)
})
