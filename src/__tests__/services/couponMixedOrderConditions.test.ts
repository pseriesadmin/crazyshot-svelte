/**
 * TDD: couponMixedOrderConditions.test.ts — (Migration 612) 대여+구매 혼합 주문의 쿠폰 주문의존 조건 판정
 * (원본 헬퍼: couponEligibilityValidation.test.ts)
 * 정책(Stephen 2026-10-01): "최소 대여일수"·"방문 전용" 쿠폰은 대여 상품에만 해당 —
 *   혼합 주문은 구매 건을 판정에서 제외하고 대여 건만 본다 / 구매 건만 있는 주문은 거절.
 */
/**
 * (구) couponEligibilityValidation.test.ts
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
  durationType?: string
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
      ...(opts.durationType ? { duration_type: opts.durationType } : {}),
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


let seq = 0
function farDates(days: number): { startDate: string; endDate: string } {
  const base = Date.UTC(2037, 0, 1) + (seq++) * 30 * 86400000 + Math.floor(Math.random() * 5) * 86400000 * 0
  const f = (t: number) => new Date(t).toISOString().slice(0, 10)
  return { startDate: f(base), endDate: f(base + days * 86400000) }
}

async function buildOrder(userId: string, lines: Array<{ kind: 'rental' | 'purchase'; pickup: string; days: number }>): Promise<number> {
  const orderId = await createOrder(userId, 100000)
  for (const l of lines) {
    const d = farDates(l.kind === 'purchase' ? 0 : l.days)
    const rid = await createReservation(userId, {
      pickupMethod: l.pickup, startDate: d.startDate, endDate: d.endDate,
      durationType: l.kind === 'purchase' ? 'purchase' : undefined,
    })
    await createOrderItem(orderId, rid)
  }
  return orderId
}

describe('쿠폰 주문의존 조건 — 대여+구매 혼합 (Migration 612)', () => {
  it('M1 혼합: 최소 대여일수 쿠폰이 구매 건(0일) 때문에 거절되지 않는다', async () => {
    const user = await createTestUser()
    const oid = await buildOrder(user.id, [{ kind: 'rental', pickup: 'visit', days: 5 }, { kind: 'purchase', pickup: 'crazydelivery', days: 0 }])
    const uc = await createUserCoupon(user.id, await createTestCoupon({ min_rental_days: 3 }))
    expect((await useCoupon(user.id, uc, oid)).ok).toBe(true)
  })
  it('M2 혼합: 방문 전용 쿠폰이 구매 건(택배 고정) 때문에 거절되지 않는다', async () => {
    const user = await createTestUser()
    const oid = await buildOrder(user.id, [{ kind: 'rental', pickup: 'visit', days: 5 }, { kind: 'purchase', pickup: 'crazydelivery', days: 0 }])
    const uc = await createUserCoupon(user.id, await createTestCoupon({ is_walk_in_only: true }))
    expect((await useCoupon(user.id, uc, oid)).ok).toBe(true)
  })
  it('M3 단독 구매: 최소 대여일수 쿠폰 거절', async () => {
    const user = await createTestUser()
    const oid = await buildOrder(user.id, [{ kind: 'purchase', pickup: 'crazydelivery', days: 0 }])
    const uc = await createUserCoupon(user.id, await createTestCoupon({ min_rental_days: 3 }))
    const r = await useCoupon(user.id, uc, oid)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('MIN_DAYS_NOT_MET')
  })
  it('M4 단독 구매: 방문 전용 쿠폰 거절', async () => {
    const user = await createTestUser()
    const oid = await buildOrder(user.id, [{ kind: 'purchase', pickup: 'crazydelivery', days: 0 }])
    const uc = await createUserCoupon(user.id, await createTestCoupon({ is_walk_in_only: true }))
    const r = await useCoupon(user.id, uc, oid)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('WALK_IN_ONLY')
  })
  it('M5 회귀: 혼합이어도 대여 건 자체가 조건 미달이면 거절(대여 1일 < 최소 3일 / 대여 택배 + 방문전용)', async () => {
    const user = await createTestUser()
    const oid1 = await buildOrder(user.id, [{ kind: 'rental', pickup: 'visit', days: 1 }, { kind: 'purchase', pickup: 'crazydelivery', days: 0 }])
    const uc1 = await createUserCoupon(user.id, await createTestCoupon({ min_rental_days: 3 }))
    expect((await useCoupon(user.id, uc1, oid1)).error).toBe('MIN_DAYS_NOT_MET')
    const oid2 = await buildOrder(user.id, [{ kind: 'rental', pickup: 'crazydelivery', days: 5 }, { kind: 'purchase', pickup: 'crazydelivery', days: 0 }])
    const uc2 = await createUserCoupon(user.id, await createTestCoupon({ is_walk_in_only: true }))
    expect((await useCoupon(user.id, uc2, oid2)).error).toBe('WALK_IN_ONLY')
  })
  it('M6 회귀: 대여만 있는 주문은 기존과 동일(충족 시 통과)', async () => {
    const user = await createTestUser()
    const oid = await buildOrder(user.id, [{ kind: 'rental', pickup: 'visit', days: 5 }])
    const uc = await createUserCoupon(user.id, await createTestCoupon({ min_rental_days: 3, is_walk_in_only: true }))
    expect((await useCoupon(user.id, uc, oid)).ok).toBe(true)
  })
})
