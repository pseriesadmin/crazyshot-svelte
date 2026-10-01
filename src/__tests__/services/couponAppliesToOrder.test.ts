/**
 * TDD: couponAppliesToOrder.test.ts — (Migration 616) 쿠폰 "적용 대상"(대여/판매, Migration 615) 서버 소진 검증
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


let seq = 100
function farDates(days: number): { startDate: string; endDate: string } {
  const base = Date.UTC(2038, 0, 1) + (seq++) * 30 * 86400000
  const f = (t: number) => new Date(t).toISOString().slice(0, 10)
  return { startDate: f(base), endDate: f(base + days * 86400000) }
}
async function buildOrder(userId: string, lines: Array<'rental' | 'purchase'>): Promise<number> {
  const orderId = await createOrder(userId, 100000)
  for (const kind of lines) {
    const d = farDates(kind === 'purchase' ? 0 : 3)
    const rid = await createReservation(userId, {
      pickupMethod: kind === 'purchase' ? 'crazydelivery' : 'visit', startDate: d.startDate, endDate: d.endDate,
      durationType: kind === 'purchase' ? 'purchase' : undefined,
    })
    await createOrderItem(orderId, rid)
  }
  return orderId
}
async function appliesCoupon(rental: boolean, sale: boolean): Promise<string> {
  const id = await createTestCoupon({})
  const { error } = await admin.from('coupons').update({ applies_to_rental: rental, applies_to_sale: sale }).eq('id', id)
  if (error) throw new Error(`적용 대상 설정 실패: ${error.message}`)
  return id
}

describe('쿠폰 적용 대상(대여/판매) 서버 소진 검증 (Migration 616)', () => {
  it('A1 대여 전용 쿠폰 + 판매 단독 주문 → COUPON_NOT_APPLICABLE', async () => {
    const u = await createTestUser()
    const oid = await buildOrder(u.id, ['purchase'])
    const uc = await createUserCoupon(u.id, await appliesCoupon(true, false))
    const r = await useCoupon(u.id, uc, oid)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('COUPON_NOT_APPLICABLE')
  })
  it('A2 판매 전용 쿠폰 + 대여 단독 주문 → COUPON_NOT_APPLICABLE', async () => {
    const u = await createTestUser()
    const oid = await buildOrder(u.id, ['rental'])
    const uc = await createUserCoupon(u.id, await appliesCoupon(false, true))
    const r = await useCoupon(u.id, uc, oid)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('COUPON_NOT_APPLICABLE')
  })
  it('A3 대여 전용 쿠폰 + 대여·판매 혼합 주문 → 허용', async () => {
    const u = await createTestUser()
    const oid = await buildOrder(u.id, ['rental', 'purchase'])
    const uc = await createUserCoupon(u.id, await appliesCoupon(true, false))
    expect((await useCoupon(u.id, uc, oid)).ok).toBe(true)
  })
  it('A4 판매 전용 쿠폰 + 혼합 주문 → 허용', async () => {
    const u = await createTestUser()
    const oid = await buildOrder(u.id, ['rental', 'purchase'])
    const uc = await createUserCoupon(u.id, await appliesCoupon(false, true))
    expect((await useCoupon(u.id, uc, oid)).ok).toBe(true)
  })
  it('A5 회귀: 둘 다 적용 쿠폰은 어떤 주문이든 허용(대여 단독·판매 단독)', async () => {
    const u = await createTestUser()
    const o1 = await buildOrder(u.id, ['rental'])
    const o2 = await buildOrder(u.id, ['purchase'])
    const c1 = await createUserCoupon(u.id, await appliesCoupon(true, true))
    const c2 = await createUserCoupon(u.id, await appliesCoupon(true, true))
    expect((await useCoupon(u.id, c1, o1)).ok).toBe(true)
    expect((await useCoupon(u.id, c2, o2)).ok).toBe(true)
  })
  it('A6 한쪽 전용 쿠폰은 주문 정보 없이는 판정할 수 없다 → ORDER_CONTEXT_REQUIRED', async () => {
    const u = await createTestUser()
    const uc = await createUserCoupon(u.id, await appliesCoupon(false, true))
    const r = await useCoupon(u.id, uc)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('ORDER_CONTEXT_REQUIRED')
  })
  it('A7 주문 사전검증(validate_order_coupons)도 같은 사유로 부적격 처리', async () => {
    const u = await createTestUser()
    const oid = await buildOrder(u.id, ['purchase'])
    const uc = await createUserCoupon(u.id, await appliesCoupon(true, false))
    const { data, error } = await admin.rpc('validate_order_coupons', { p_user_id: u.id, p_order_id: oid, p_user_coupon_ids: [uc] })
    expect(error).toBeNull()
    const res = data as { ok: boolean; results: Array<{ user_coupon_id: string; ok: boolean; error: string | null }> }
    expect(res.ok).toBe(false)
    expect(res.results[0].error).toBe('COUPON_NOT_APPLICABLE')
  })
})
