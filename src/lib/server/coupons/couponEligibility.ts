/**
 * couponEligibility.ts — 쿠폰 자격조건 7개 검증 헬퍼
 * TASK.md "쿠폰 자격조건 7개 검증" — Migration 348 서버사이드 대응
 *
 * 역할: cart/+page.server.ts + contract/[token]/+page.server.ts에서
 *       filteredCoupons 필터링 시 7개 자격조건을 동일 로직으로 검증한다.
 *       DB 레벨(use_coupon RPC, Migration 348)과 이중 방어(defense-in-depth).
 *
 * Q1(전체AND): min_rental_days는 주문 내 모든 예약의 최소일수, is_walk_in_only는 전체 방문
 * Q2(첫대여): rental_reservations 직접 조회 (rental_count 컬럼 사용 금지)
 * Q3(금액): min_purchase_amount/min_rental_amount 둘 다 orders.total_amount 기준
 * Q4-5: use_coupon 시그니처 불변, p_order_id 내부 재조회
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ── 7개 자격조건 필드 (coupons 테이블 컬럼과 1:1 대응) ──────────────────────
export interface CouponEligibilityFields {
  min_purchase_amount:  number
  min_rental_amount:    number
  min_rental_days:      number
  is_first_rental_only: boolean
  is_student_only:      boolean
  is_subscription_only: boolean
  is_walk_in_only:      boolean
}

// ── 주문/사용자 컨텍스트 (DB 조회 결과 → 정규화된 값) ───────────────────────
export interface CouponEligibilityContext {
  /** orders.total_amount (Q3 기준, 주문 없으면 null) */
  orderAmount:          number | null
  /** 주문 내 예약 최소 대여일수 (Q1 전체AND, 주문 없으면 null) */
  minRentalDaysInOrder: number | null
  /** 주문 내 모든 예약이 pickup_method='visit' (Q1 전체AND, 주문 없으면 null) */
  allWalkIn:            boolean | null
  /** 이번이 첫 대여인가 (Q2 신규판정: hold/draft/cancelled/expired 제외) */
  isFirstRental:        boolean
  /** user_profiles.is_student = true */
  isStudent:            boolean
  /** subscriptions.status='active' AND deleted_at IS NULL 존재 여부 */
  hasActiveSubscription: boolean
}

// ── 순수 함수: 쿠폰 1개 자격 검증 ────────────────────────────────────────────
/**
 * 7개 자격조건 검증 — DB 없이 동작하는 순수 함수(테스트 가능).
 * use_coupon RPC(Migration 348) 서버사이드 이중 방어용.
 *
 * @param coupon 자격조건 필드 (coupons 테이블에서 SELECT)
 * @param ctx    컨텍스트 (buildCouponEligibilityContext 결과)
 * @returns { ok: true } 또는 { ok: false, reason: 에러코드 }
 */
export function isCouponEligible(
  coupon: CouponEligibilityFields,
  ctx:    CouponEligibilityContext,
): { ok: boolean; reason?: string } {

  // ── 주문의존 조건 체크 ──────────────────────────────────────────────────────
  const hasOrderCondition =
    coupon.min_purchase_amount  > 0 ||
    coupon.min_rental_amount    > 0 ||
    coupon.min_rental_days      > 0 ||
    coupon.is_walk_in_only

  if (hasOrderCondition) {
    // EC-4 안전측 실패: 주문 컨텍스트 없이는 조건 충족 불가
    if (ctx.orderAmount === null) {
      return { ok: false, reason: 'ORDER_CONTEXT_REQUIRED' }
    }

    // Q3: min_purchase_amount / min_rental_amount — 둘 다 total_amount 기준
    if (coupon.min_purchase_amount > 0 && ctx.orderAmount < coupon.min_purchase_amount) {
      return { ok: false, reason: 'MIN_AMOUNT_NOT_MET' }
    }
    if (coupon.min_rental_amount > 0 && ctx.orderAmount < coupon.min_rental_amount) {
      return { ok: false, reason: 'MIN_AMOUNT_NOT_MET' }
    }

    // Q1 전체AND: min_rental_days — 주문 내 모든 예약의 최소일수
    if (coupon.min_rental_days > 0) {
      if (ctx.minRentalDaysInOrder === null || ctx.minRentalDaysInOrder < coupon.min_rental_days) {
        return { ok: false, reason: 'MIN_DAYS_NOT_MET' }
      }
    }

    // Q1 전체AND: is_walk_in_only — 모든 예약이 pickup_method='visit'
    if (coupon.is_walk_in_only) {
      if (!ctx.allWalkIn) {
        return { ok: false, reason: 'WALK_IN_ONLY' }
      }
    }
  }

  // ── 사용자의존 조건 체크 ───────────────────────────────────────────────────
  if (coupon.is_first_rental_only && !ctx.isFirstRental) {
    return { ok: false, reason: 'FIRST_RENTAL_ONLY' }
  }

  if (coupon.is_student_only && !ctx.isStudent) {
    return { ok: false, reason: 'STUDENT_ONLY' }
  }

  if (coupon.is_subscription_only && !ctx.hasActiveSubscription) {
    return { ok: false, reason: 'SUBSCRIPTION_ONLY' }
  }

  return { ok: true }
}

// ── DB 컨텍스트 빌더 ─────────────────────────────────────────────────────────
/**
 * DB를 조회해 CouponEligibilityContext를 빌드한다.
 *
 * @param client   Supabase 클라이언트 (service_role 권장)
 * @param userId   검증 대상 사용자 UUID
 * @param orderId  현재 주문 ID (없으면 null — 주문의존 조건은 모두 안전측 실패)
 * @param reservationIds 이미 알고 있는 예약 ID 배열 (orderId 있을 때만 사용)
 */
export async function buildCouponEligibilityContext(
  client:           SupabaseClient,
  userId:           string,
  orderId:          number | null,
  reservationIds?:  number[],
): Promise<CouponEligibilityContext> {

  // ── 주문 컨텍스트 (주문의존 조건용) ─────────────────────────────────────
  let orderAmount:          number | null = null
  let minRentalDaysInOrder: number | null = null
  let allWalkIn:            boolean | null = null

  if (orderId !== null) {
    // 주문 총액
    const { data: orderRow } = await (client as unknown as {
      from: (t: string) => { select: (c: string) => { eq: (k: string, v: number) => { maybeSingle: () => Promise<{ data: { total_amount: number } | null }> } } }
    }).from('orders').select('total_amount').eq('id', orderId).maybeSingle()
    orderAmount = orderRow?.total_amount ?? null

    // 예약 집계 (min_rental_days, allWalkIn)
    // reservationIds가 이미 있으면 별도 order_items 조회 없이 재사용
    let rIds = reservationIds ?? []
    if (rIds.length === 0) {
      const { data: items } = await (client as unknown as {
        from: (t: string) => {
          select: (c: string) => { eq: (k: string, v: number) => Promise<{ data: { reservation_id: number }[] | null }> }
        }
      }).from('order_items').select('reservation_id').eq('order_id', orderId)
      rIds = (items ?? []).map((r) => r.reservation_id)
    }

    if (rIds.length > 0) {
      const { data: reservations } = await (client as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            in: (k: string, v: number[]) => Promise<{ data: { start_date: string; end_date: string; pickup_method: string }[] | null }>
          }
        }
      }).from('rental_reservations')
        .select('start_date, end_date, pickup_method')
        .in('id', rIds)

      if (reservations && reservations.length > 0) {
        const days = reservations.map((r) => {
          const start = new Date(r.start_date)
          const end   = new Date(r.end_date)
          return Math.round((end.getTime() - start.getTime()) / 86400000) + 1
        })
        minRentalDaysInOrder = Math.min(...days)
        allWalkIn = reservations.every((r) => r.pickup_method === 'visit')
      }
    }
  }

  // ── 사용자 컨텍스트 ─────────────────────────────────────────────────────
  // Q2: rental_reservations 직접 조회 (rental_count 컬럼 사용 금지)
  const EXCLUDE_STATUSES = ['hold', 'draft', 'cancelled', 'expired']

  const [profileResult, firstRentalResult, subResult] = await Promise.all([
    (client as unknown as {
      from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { is_student: boolean | null } | null }> } } }
    }).from('user_profiles').select('is_student').eq('id', userId).maybeSingle(),

    // ⚠️ rental_reservations에는 deleted_at 컬럼이 없음(Migration 348 적용 전 재검증으로
    // 발견 — use_coupon RPC와 동일 실수, 여기서도 제거)
    (client as unknown as {
      from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { not: (k: string, o: string, v: string) => { limit: (n: number) => Promise<{ data: unknown[] | null }> } } } }
    }).from('rental_reservations')
      .select('id')
      .eq('user_id', userId)
      .not('status', 'in', `(${EXCLUDE_STATUSES.map((s) => `"${s}"`).join(',')})`)
      .limit(1),

    // 실제 구독 테이블명은 subscriptions가 아니라 user_subscriptions이고, 이 테이블에도
    // deleted_at 컬럼이 없음(status CHECK 제약이 'active'/'cancelled'/'expired'만 허용)
    (client as unknown as {
      from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { eq: (k: string, v: string) => { limit: (n: number) => Promise<{ data: unknown[] | null }> } } } }
    }).from('user_subscriptions')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .limit(1),
  ])

  const isStudent            = profileResult.data?.is_student === true
  const isFirstRental        = (firstRentalResult.data?.length ?? 0) === 0
  const hasActiveSubscription = (subResult.data?.length ?? 0) > 0

  return {
    orderAmount,
    minRentalDaysInOrder,
    allWalkIn,
    isFirstRental,
    isStudent,
    hasActiveSubscription,
  }
}
