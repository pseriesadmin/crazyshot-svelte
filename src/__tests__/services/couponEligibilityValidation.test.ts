/**
 * TDD-RED: couponEligibilityValidation.test.ts
 * use_coupon RPC 7개 자격조건 검증 (TASK.md "쿠폰 자격조건 7개 검증" — GATE B 승인 2026-08-25)
 *
 * 이 테스트는 Migration 348 적용 전에는 RED(신규 에러코드 미반환),
 * 적용 후에는 전부 GREEN이 되어야 한다.
 *
 * 테스트 전략:
 *   - Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 연동 (couponLazySequencing.test.ts 동일 패턴)
 *   - 각 테스트마다 ephemeral 사용자 + 쿠폰 + user_coupon 생성 후 afterEach에서 삭제
 *   - 주문의존 조건(EC-2/4) 테스트는 orders + order_items + rental_reservations 직접 INSERT
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ── 정리 대상 ID 추적 ─────────────────────────────────────────────────────
const cleanupUserIds:        string[]  = []
const cleanupCouponIds:      string[]  = []
const cleanupUserCouponIds:  string[]  = []
const cleanupOrderIds:       number[]  = []
const cleanupReservationIds: number[]  = []

// ── 헬퍼: ephemeral 테스트 사용자 생성 ────────────────────────────────────
async function createTestUser() {
  const email = `test_coupon_elig_${Date.now()}_${Math.random().toString(36).slice(2)}@crazyshot-test.invalid`
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
type CouponConditions = {
  min_purchase_amount?: number
  min_rental_amount?: number
  min_rental_days?: number
  is_first_rental_only?: boolean
  is_student_only?: boolean
  is_subscription_only?: boolean
  is_walk_in_only?: boolean
  is_active?: boolean
  valid_until?: string  // 만료 쿠폰 테스트용
}

async function createTestCoupon(conditions: CouponConditions = {}) {
  const code = `TEST_ELIG_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`
  const row = {
    code,
    type:                 'all',           // NOT NULL 필수 — Stage DB 확인값
    validity_type:        'fixed_period',  // NOT NULL 필수 — Stage DB 확인값
    discount_type:        'fixed' as const,
    discount_value:       1000,
    is_active:            conditions.is_active ?? true,
    valid_from:           null,
    valid_until:          conditions.valid_until ?? null,
    min_purchase_amount:  conditions.min_purchase_amount  ?? 0,
    min_rental_amount:    conditions.min_rental_amount    ?? 0,
    min_rental_days:      conditions.min_rental_days      ?? 0,
    is_first_rental_only: conditions.is_first_rental_only ?? false,
    is_student_only:      conditions.is_student_only      ?? false,
    is_subscription_only: conditions.is_subscription_only ?? false,
    is_walk_in_only:      conditions.is_walk_in_only      ?? false,
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

// ── 헬퍼: orders 행 INSERT ───────────────────────────────────────────────────
async function createOrder(userId: string, totalAmount: number): Promise<number> {
  const orderKey = `TEST-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
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
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`order 생성 실패: ${JSON.stringify(error)}`)
  cleanupOrderIds.push(data.id)
  return data.id
}

// ── 헬퍼: rental_reservation INSERT (최소 필드) ──────────────────────────────
async function createReservation(userId: string, opts: {
  status?: string
  pickupMethod?: string
  startDate?: string
  endDate?: string
}): Promise<number> {
  const code = `RSV-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
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
      status:           opts.status       ?? 'hold',
      pickup_method:    opts.pickupMethod ?? 'visit',
      start_date:       opts.startDate    ?? '2026-09-01',
      end_date:         opts.endDate      ?? '2026-09-03',
      // rental_days는 GENERATED COLUMN — INSERT 제외
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`reservation 생성 실패: ${JSON.stringify(error)}`)
  cleanupReservationIds.push(data.id)
  return data.id
}

// ── 헬퍼: order_items 연결 ───────────────────────────────────────────────────
async function createOrderItem(orderId: number, reservationId: number) {
  const { error } = await (admin as unknown as {
    from: (t: string) => { insert: (r: Record<string, unknown>) => Promise<{ error: unknown }> }
  }).from('order_items')
    .insert({
      order_id:       orderId,
      reservation_id: reservationId,
      product_id:     '12361ae3-5bbc-4da8-9fbb-8249241fab65', // Stage DB 활성 자식 상품 (NOT NULL) — createReservation과 동일 fixture
      quantity:       1,
      unit_price:     0,
      line_total:     0,
    })
  if (error) throw new Error(`order_item 생성 실패: ${JSON.stringify(error)}`)
}

// ── use_coupon 호출 헬퍼 ──────────────────────────────────────────────────────
async function useCoupon(userId: string, userCouponId: string, orderId?: number) {
  const { data, error } = await admin.rpc('use_coupon', {
    p_user_id:         userId,
    p_user_coupon_id:  userCouponId,
    p_order_id:        orderId ?? null,
  })
  if (error) throw new Error(`use_coupon RPC 오류: ${error.message}`)
  return data as { ok: boolean; error?: string; redeemed_code?: string | null }
}

// ── 정리 ──────────────────────────────────────────────────────────────────────
// ⚠️ order_items.order_id/reservation_id FK 둘 다 ON DELETE CASCADE가 아님(RESTRICT
// 기본값) — orders/rental_reservations를 삭제하기 전에 order_items를 먼저 명시적으로
// 지워야 한다(2026-08-25 실측으로 발견 — cascade 가정이 틀려 삭제가 조용히 실패하고
// 다음 테스트가 exclusion 제약(rental_reservations_product_dates_excl) 충돌로 깨졌음).
// 에러도 반드시 throw해 향후 같은 종류의 정리 실패가 다시 조용히 묻히지 않도록 한다.
afterEach(async () => {
  if (cleanupUserCouponIds.length > 0) {
    const { error } = await (admin as unknown as { from: (t: string) => { delete: () => { in: (k: string, v: string[]) => Promise<{ error: unknown }> } } })
      .from('user_coupons').delete().in('id', cleanupUserCouponIds)
    if (error) throw new Error(`cleanup user_coupons 실패: ${JSON.stringify(error)}`)
    cleanupUserCouponIds.length = 0
  }
  if (cleanupCouponIds.length > 0) {
    const { error } = await (admin as unknown as { from: (t: string) => { delete: () => { in: (k: string, v: string[]) => Promise<{ error: unknown }> } } })
      .from('coupons').delete().in('id', cleanupCouponIds)
    if (error) throw new Error(`cleanup coupons 실패: ${JSON.stringify(error)}`)
    cleanupCouponIds.length = 0
  }
  if (cleanupOrderIds.length > 0) {
    // order_items는 cascade가 아니므로 orders보다 먼저 명시적으로 삭제
    const { error: oiError } = await (admin as unknown as { from: (t: string) => { delete: () => { in: (k: string, v: number[]) => Promise<{ error: unknown }> } } })
      .from('order_items').delete().in('order_id', cleanupOrderIds)
    if (oiError) throw new Error(`cleanup order_items 실패: ${JSON.stringify(oiError)}`)
    const { error } = await (admin as unknown as { from: (t: string) => { delete: () => { in: (k: string, v: number[]) => Promise<{ error: unknown }> } } })
      .from('orders').delete().in('id', cleanupOrderIds)
    if (error) throw new Error(`cleanup orders 실패: ${JSON.stringify(error)}`)
    cleanupOrderIds.length = 0
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

describe('use_coupon RPC — 7개 자격조건 검증 (TDD-RED: Migration 348 적용 전 실패해야 함)', () => {

  // ── EC-1: 기본 쿠폰(조건 없음) + order_id NULL → ok:true (마이그레이션 전후 모두 통과) ──
  it('EC-1: 기본 쿠폰(조건 없음) + p_order_id NULL → ok:true (무조건 통과)', async () => {
    const user = await createTestUser()
    const couponId = await createTestCoupon()
    const ucId     = await createUserCoupon(user.id, couponId)
    const result   = await useCoupon(user.id, ucId)
    expect(result.ok).toBe(true)
  }, 20000)

  // ── EC-4: min_purchase_amount + p_order_id NULL → ORDER_CONTEXT_REQUIRED ──
  it('EC-4-A: min_purchase_amount>0 + p_order_id NULL → ORDER_CONTEXT_REQUIRED', async () => {
    const user = await createTestUser()
    const couponId = await createTestCoupon({ min_purchase_amount: 50000 })
    const ucId     = await createUserCoupon(user.id, couponId)
    const result   = await useCoupon(user.id, ucId, undefined)  // order_id 없음
    expect(result.ok).toBe(false)
    expect(result.error).toBe('ORDER_CONTEXT_REQUIRED')
  }, 20000)

  // ── EC-4: min_rental_days + p_order_id NULL → ORDER_CONTEXT_REQUIRED ──
  it('EC-4-B: min_rental_days>0 + p_order_id NULL → ORDER_CONTEXT_REQUIRED', async () => {
    const user = await createTestUser()
    const couponId = await createTestCoupon({ min_rental_days: 3 })
    const ucId     = await createUserCoupon(user.id, couponId)
    const result   = await useCoupon(user.id, ucId)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('ORDER_CONTEXT_REQUIRED')
  }, 20000)

  // ── EC-4: is_walk_in_only + p_order_id NULL → ORDER_CONTEXT_REQUIRED ──
  it('EC-4-C: is_walk_in_only=true + p_order_id NULL → ORDER_CONTEXT_REQUIRED', async () => {
    const user = await createTestUser()
    const couponId = await createTestCoupon({ is_walk_in_only: true })
    const ucId     = await createUserCoupon(user.id, couponId)
    const result   = await useCoupon(user.id, ucId)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('ORDER_CONTEXT_REQUIRED')
  }, 20000)

  // ── EC-2: min_rental_amount>0 + 주문 total_amount 미달 → MIN_AMOUNT_NOT_MET ──
  it('EC-2: min_rental_amount=200000, 주문 total_amount=100000 → MIN_AMOUNT_NOT_MET', async () => {
    const user     = await createTestUser()
    const orderId  = await createOrder(user.id, 100000)
    const couponId = await createTestCoupon({ min_rental_amount: 200000 })
    const ucId     = await createUserCoupon(user.id, couponId)
    const result   = await useCoupon(user.id, ucId, orderId)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('MIN_AMOUNT_NOT_MET')
  }, 20000)

  // ── WALK_IN_ONLY: 배송 예약 포함된 주문에서 방문전용 쿠폰 사용 → WALK_IN_ONLY ──
  it('WALK_IN_ONLY: 비방문(delivery) 예약이 포함된 주문 → WALK_IN_ONLY', async () => {
    const user    = await createTestUser()
    const orderId = await createOrder(user.id, 150000)
    const rsvId   = await createReservation(user.id, { pickupMethod: 'delivery' })
    await createOrderItem(orderId, rsvId)

    const couponId = await createTestCoupon({ is_walk_in_only: true })
    const ucId     = await createUserCoupon(user.id, couponId)
    const result   = await useCoupon(user.id, ucId, orderId)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('WALK_IN_ONLY')
  }, 25000)

  // ── STUDENT_ONLY: 학생 아닌 사용자 → STUDENT_ONLY ──────────────────────────
  it('STUDENT_ONLY: user_profiles.is_student!=true인 사용자 → STUDENT_ONLY', async () => {
    const user = await createTestUser()
    // user_profiles.is_student는 기본값 false — 별도 조작 불필요
    const couponId = await createTestCoupon({ is_student_only: true })
    const ucId     = await createUserCoupon(user.id, couponId)
    const result   = await useCoupon(user.id, ucId)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('STUDENT_ONLY')
  }, 20000)

  // ── SUBSCRIPTION_ONLY: 활성 구독 없는 사용자 → SUBSCRIPTION_ONLY ────────────
  it('SUBSCRIPTION_ONLY: 활성 구독 없는 사용자 → SUBSCRIPTION_ONLY', async () => {
    const user = await createTestUser()
    const couponId = await createTestCoupon({ is_subscription_only: true })
    const ucId     = await createUserCoupon(user.id, couponId)
    const result   = await useCoupon(user.id, ucId)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('SUBSCRIPTION_ONLY')
  }, 20000)

  // ── FIRST_RENTAL_ONLY: 대여 이력 있는 사용자 → FIRST_RENTAL_ONLY ────────────
  it('FIRST_RENTAL_ONLY: confirmed 이력 있는 사용자 → FIRST_RENTAL_ONLY', async () => {
    const user  = await createTestUser()
    // 이 사용자의 기존 confirmed 예약 시뮬레이션
    await createReservation(user.id, { status: 'confirmed' })

    const couponId = await createTestCoupon({ is_first_rental_only: true })
    const ucId     = await createUserCoupon(user.id, couponId)
    const result   = await useCoupon(user.id, ucId)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('FIRST_RENTAL_ONLY')
  }, 25000)

  // ── FIRST_RENTAL_ONLY 무회귀: hold 이력만 있는 사용자는 "첫 대여"로 인정 ────
  it('FIRST_RENTAL_ONLY 무회귀: hold만 있는 사용자는 첫 대여 = ok:true', async () => {
    const user  = await createTestUser()
    await createReservation(user.id, { status: 'hold' })  // hold는 제외 대상

    const couponId = await createTestCoupon({ is_first_rental_only: true })
    const ucId     = await createUserCoupon(user.id, couponId)
    const result   = await useCoupon(user.id, ucId)
    expect(result.ok).toBe(true)
  }, 25000)

  // ── 무회귀: COUPON_NOT_FOUND ─────────────────────────────────────────────────
  it('무회귀: 존재하지 않는 user_coupon_id → COUPON_NOT_FOUND', async () => {
    const user   = await createTestUser()
    const fakeId = '00000000-0000-0000-0000-000000000000'
    const result = await useCoupon(user.id, fakeId)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('COUPON_NOT_FOUND')
  }, 15000)

  // ── 무회귀: ALREADY_USED ─────────────────────────────────────────────────────
  it('무회귀: 이미 사용된 쿠폰 → ALREADY_USED', async () => {
    const user     = await createTestUser()
    const couponId = await createTestCoupon()
    const ucId     = await createUserCoupon(user.id, couponId, new Date().toISOString())
    const result   = await useCoupon(user.id, ucId)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('ALREADY_USED')
  }, 20000)

  // ── 무회귀: COUPON_INACTIVE ───────────────────────────────────────────────────
  it('무회귀: is_active=false 쿠폰 → COUPON_INACTIVE', async () => {
    const user     = await createTestUser()
    const couponId = await createTestCoupon({ is_active: false })
    const ucId     = await createUserCoupon(user.id, couponId)
    const result   = await useCoupon(user.id, ucId)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('COUPON_INACTIVE')
  }, 20000)

  // ── 무회귀: COUPON_EXPIRED ────────────────────────────────────────────────────
  it('무회귀: 만료된 쿠폰 → COUPON_EXPIRED', async () => {
    const user     = await createTestUser()
    const couponId = await createTestCoupon({ valid_until: '2020-01-01T00:00:00Z' })
    const ucId     = await createUserCoupon(user.id, couponId)
    const result   = await useCoupon(user.id, ucId)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('COUPON_EXPIRED')
  }, 20000)
})
