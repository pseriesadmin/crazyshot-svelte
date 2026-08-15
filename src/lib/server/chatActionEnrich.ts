// src/lib/server/chatActionEnrich.ts
// AC-1: intent/action_card.type별 실데이터 조회 후처리 (AI 파이프라인 전용)
//
// AI(Claude)는 action_card.type(의도 분류 결과)만 결정한다.
// 서버가 type별로 DB를 조회해 ActionPayload의 세부 필드(product_name·product_price·
// reservation_no·action_url 등)를 채우는 후처리 단계.
//
// 조회 실패 / 데이터 없음 → type + is_expired:false만 있는 기본 페이로드로 폴백 (크래시 없음).
// 지원 타입: PRODUCT_CARD, RESERVATION_STATUS_CARD, RETURN_REGISTRATION_CARD,
//           COUPON_GIFT_CARD, SHIPMENT_TRACKING_CARD, PAYMENT_REQUEST_CARD(연체료)
//           — 나머지는 기본 페이로드 반환.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ActionPayload } from '$lib/types/chat'
import { getTrackingStatus } from '$lib/server/courierTracking'

/** chat_sessions 에서 읽어온 세션 컨텍스트 */
export interface EnrichContext {
  context_type: string
  context_id: string | null // UUID (rental_reservations.id는 BIGINT라 여기에 담기지 않음)
}

/**
 * AI가 결정한 action_card.type을 받아 세션 컨텍스트와 userId 기반으로
 * DB에서 실데이터를 조회해 ActionPayload 필드를 완성하는 순수 함수.
 *
 * - PRODUCT_CARD: context_type='product_inquiry' + context_id(상품 UUID) 우선 → DB 조회
 * - RESERVATION_STATUS_CARD: userId 기반 최근 활성 예약 조회
 * - 그 외 타입: type + is_expired:false만 있는 기본 페이로드 반환 (확장 여지)
 *
 * 에러 처리: DB 조회 실패 시 try/catch → 기본 페이로드로 폴백 (메시지 자체는 계속 발송)
 */
export async function enrichActionCard(
  type: string,
  userId: string,
  sessionCtx: EnrichContext,
  admin: SupabaseClient,
): Promise<ActionPayload> {
  const base: ActionPayload = { type: type as ActionPayload['type'], is_expired: false }
  try {
    if (type === 'PRODUCT_CARD') {
      return await enrichProductCard(base, sessionCtx, admin)
    }
    if (type === 'RESERVATION_STATUS_CARD') {
      return await enrichReservationStatusCard(base, userId, sessionCtx, admin)
    }
    if (type === 'RETURN_REGISTRATION_CARD') {
      return await enrichReturnRegistrationCard(base, userId, admin)
    }
    if (type === 'COUPON_GIFT_CARD') {
      return await enrichCouponGiftCard(base, admin)
    }
    if (type === 'SHIPMENT_TRACKING_CARD') {
      return await enrichShipmentTrackingCard(base, userId, admin)
    }
    if (type === 'PAYMENT_REQUEST_CARD') {
      return await enrichPaymentRequestCard(base, userId, admin)
    }
    return base
  } catch {
    // DB 조회 실패 시 타입만 있는 기본 카드로 폴백 — 메시지 발송 자체는 중단하지 않는다
    return base
  }
}

// ---------------------------------------------------------------------------
// 내부 헬퍼 — 외부에서 직접 호출하지 않는다

async function enrichProductCard(
  base: ActionPayload,
  sessionCtx: EnrichContext,
  admin: SupabaseClient,
): Promise<ActionPayload> {
  // context_type='product_inquiry' + context_id(UUID)가 있을 때만 조회
  // — 없으면 AI가 어떤 상품을 말하는지 특정할 수 없으므로 기본 페이로드 반환
  const productId =
    sessionCtx.context_type === 'product_inquiry' && sessionCtx.context_id
      ? sessionCtx.context_id
      : null
  if (!productId) return base

  const { data: productRaw } = await admin
    .from('products')
    .select('id, name, slug, image_urls, parent_product_id')
    .eq('id', productId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!productRaw) return base

  const product = productRaw as Record<string, unknown>
  const parentId = product.parent_product_id as string | null

  // 가격·슬러그는 항상 부모 기준 (§4-1: 자식은 등록정보를 부모에서만 관리)
  const policyId = parentId ?? productId
  let productSlug = product.slug as string

  if (parentId) {
    const { data: parentRaw } = await admin
      .from('products')
      .select('slug')
      .eq('id', parentId)
      .maybeSingle()
    if (parentRaw) {
      productSlug = (parentRaw as Record<string, unknown>).slug as string
    }
  }

  const { data: priceRaw } = await admin
    .from('price_rules')
    .select('price')
    .eq('product_id', policyId)
    .eq('duration_type', '24h')
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()

  const dailyRate = priceRaw
    ? ((priceRaw as Record<string, unknown>).price as number)
    : undefined

  const imageUrls = product.image_urls as string[] | null

  return {
    ...base,
    product_id: productId,
    product_name: product.name as string,
    product_price: dailyRate,
    product_image: imageUrls?.[0],
    action_url: `/products/${productSlug}`,
  }
}

async function enrichReservationStatusCard(
  base: ActionPayload,
  userId: string,
  _sessionCtx: EnrichContext,
  admin: SupabaseClient,
): Promise<ActionPayload> {
  // rental_reservations.id는 BIGINT(number)라 chat_sessions.context_id(UUID)로는 매칭 불가
  // → userId 기반으로 가장 최근 활성 예약을 조회
  type ReservationRow = {
    id: number
    reservation_code: string | null
    status: string
    product_id: string
  }

  const { data: reservationRaw } = await admin
    .from('rental_reservations')
    .select('id, reservation_code, status, product_id')
    .eq('user_id', userId)
    .in('status', ['hold', 'confirmed', 'shipped', 'in_use', 'return_requested'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!reservationRaw) return base

  const reservation = reservationRaw as ReservationRow

  // 상품 정보 조회 (부모 기준 — §4-1 동일 원칙)
  const { data: productRaw } = await admin
    .from('products')
    .select('name, parent_product_id')
    .eq('id', reservation.product_id)
    .maybeSingle()

  let productName: string | undefined

  if (productRaw) {
    const product = productRaw as Record<string, unknown>
    const parentId = product.parent_product_id as string | null
    productName = product.name as string

    if (parentId) {
      const { data: parentRaw } = await admin
        .from('products')
        .select('name')
        .eq('id', parentId)
        .maybeSingle()
      if (parentRaw) {
        productName = (parentRaw as Record<string, unknown>).name as string
      }
    }
  }

  return {
    ...base,
    reservation_id: String(reservation.id),
    reservation_no: reservation.reservation_code ?? undefined,
    product_name: productName,
    action_url: '/account/reservations',
  }
}

// ---------------------------------------------------------------------------
// RETURN_REGISTRATION_CARD — 반납 방법 선택 카드 (P2-④)
// in_use 진입 전까지만 변경 허용 — 이상 상태이면 is_expired:true 처리

async function enrichReturnRegistrationCard(
  base: ActionPayload,
  userId: string,
  admin: SupabaseClient,
): Promise<ActionPayload> {
  // in_use 이상 상태 = 카드 만료 처리 (서버 API도 동일 기준으로 차단)
  const LOCKED_STATUSES = new Set([
    'in_use', 'return_requested', 'returned', 'completed', 'damage_claimed',
  ])

  type ReservationRow = {
    id: number
    reservation_code: string | null
    status: string
    return_method: string | null
  }

  // userId 기반 가장 최근 진행중 예약 조회
  // (hold, confirmed, shipped: 변경 가능 / in_use 이상: 만료 처리)
  const { data: reservationRaw } = await admin
    .from('rental_reservations')
    .select('id, reservation_code, status, return_method')
    .eq('user_id', userId)
    .in('status', ['hold', 'confirmed', 'shipped', 'in_use', 'return_requested'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!reservationRaw) return base

  const reservation = reservationRaw as ReservationRow
  const isLocked = LOCKED_STATUSES.has(reservation.status)

  return {
    ...base,
    reservation_id: String(reservation.id),
    reservation_no: reservation.reservation_code ?? undefined,
    action_url: `/account/rental/${reservation.id}/return-method`,
    is_expired: isLocked,
  }
}

// ---------------------------------------------------------------------------
// SHIPMENT_TRACKING_CARD — 운송장 번호·택배사 기반 배송 추적 카드 (P2-②)
// tracking_number/courier_code가 없으면 "등록 전" 상태 카드 — action_url 미설정
// 있으면 getTrackingStatus() 결과를 payload에 채움 (1차: 스텁 상태)

async function enrichShipmentTrackingCard(
  base: ActionPayload,
  userId: string,
  admin: SupabaseClient,
): Promise<ActionPayload> {
  type ReservationRow = {
    id: number
    reservation_code: string | null
    status: string
    product_id: string
    tracking_number: string | null
    courier_code: string | null
  }

  // userId 기반 가장 최근 진행중 예약 조회 (배송 추적 대상)
  const { data: reservationRaw } = await admin
    .from('rental_reservations')
    .select('id, reservation_code, status, product_id, tracking_number, courier_code')
    .eq('user_id', userId)
    .in('status', ['hold', 'confirmed', 'shipped', 'in_use', 'return_requested'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!reservationRaw) return base

  const reservation = reservationRaw as ReservationRow

  // 상품명 조회 — 부모 기준 (§4-1: 자식은 등록정보를 부모에서만 관리)
  let productName: string | undefined
  const { data: productRaw } = await admin
    .from('products')
    .select('name, parent_product_id')
    .eq('id', reservation.product_id)
    .maybeSingle()

  if (productRaw) {
    const product = productRaw as Record<string, unknown>
    const parentId = product.parent_product_id as string | null
    productName = product.name as string

    if (parentId) {
      const { data: parentRaw } = await admin
        .from('products')
        .select('name')
        .eq('id', parentId)
        .maybeSingle()
      if (parentRaw) productName = (parentRaw as Record<string, unknown>).name as string
    }
  }

  // 공통 base 페이로드
  const basePayload: ActionPayload = {
    ...base,
    reservation_id: String(reservation.id),
    reservation_no: reservation.reservation_code ?? undefined,
    product_name:   productName,
  }

  // 운송장 정보가 없으면 — "송장번호 등록 전" 상태 (action_url 없음, tracking_number 없음)
  if (!reservation.tracking_number || !reservation.courier_code) {
    return basePayload
  }

  // 운송장 정보가 있으면 — 추적 상태 조회 (1차: 스텁 반환)
  const trackingStatus = await getTrackingStatus(
    reservation.courier_code,
    reservation.tracking_number,
  )

  return {
    ...basePayload,
    tracking_number: reservation.tracking_number,
    carrier:         reservation.courier_code,   // courier_code를 carrier 표시명으로 사용
    carrier_url:     trackingStatus?.detailUrl ?? undefined,
    action_url:      trackingStatus?.detailUrl ?? undefined,
  }
}

// ---------------------------------------------------------------------------
// PAYMENT_REQUEST_CARD — 연체료 결제 요청 카드
// userId 기준 미납(is_paid=false) late_fees 중 최신 1건 조회.
// 있으면 fee_amount·hours_late·late_fee_id·action_url 채움.
// 없으면 is_expired:true (연체 없는 고객이 의도 분류 됐을 때 폴백).

async function enrichPaymentRequestCard(
  base: ActionPayload,
  userId: string,
  admin: SupabaseClient,
): Promise<ActionPayload> {
  // late_fees에는 user_id가 없으므로 2단계 조회:
  //   1) rental_reservations에서 해당 userId의 reservation_id 목록 조회
  //   2) late_fees에서 그 중 is_paid=false인 최신 1건 조회
  //
  // 단순화: userId의 reservation_id 목록을 먼저 가져온 뒤 late_fees 조회

  // 1단계: 사용자 예약 ID 목록
  // rental_reservations에는 deleted_at 컬럼이 없음(소프트삭제 미지원 테이블) — 존재하지 않는
  // 컬럼 필터를 걸면 PostgREST 쿼리 자체가 에러를 반환해 매번 조용히 is_expired:true로 폴백되던
  // 버그였음(메인세션 재검증 시 발견·제거)
  const { data: reservationsRaw } = await admin
    .from('rental_reservations')
    .select('id')
    .eq('user_id', userId)

  if (!reservationsRaw || (reservationsRaw as unknown[]).length === 0) {
    return { ...base, is_expired: true }
  }

  const reservationIds = (reservationsRaw as { id: number }[]).map((r) => r.id)

  // 2단계: 미납 연체료 최신 1건 (created_at DESC)
  const { data: feeRaw } = await admin
    .from('late_fees')
    .select('id, reservation_id, fee_amount, hours_late, is_paid')
    .in('reservation_id', reservationIds)
    .eq('is_paid', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!feeRaw) {
    return { ...base, is_expired: true }
  }

  const fee = feeRaw as { id: string; fee_amount: number; hours_late: number }

  return {
    ...base,
    is_expired: false,
    late_fee_id: fee.id,
    fee_amount:  fee.fee_amount,
    hours_late:  fee.hours_late,
    action_url:  `/pay/late-fee/${fee.id}`,
  }
}

// ---------------------------------------------------------------------------
// COUPON_GIFT_CARD — AI 경로: 관리자 승인 대기 상태(pending)로 카드 생성
// 승인 전에는 action_url 없음 — 고객 화면에 "쿠폰 확인 중" 비활성 버튼만 노출

async function enrichCouponGiftCard(
  base: ActionPayload,
  admin: SupabaseClient,
): Promise<ActionPayload> {
  // 활성 쿠폰 중 유효기간이 남은 쿠폰 1개 선택 (생성 역순)
  const now = new Date().toISOString()

  type CouponRow = {
    id: string
    code: string
    discount_type: string
    discount_value: number
  }

  const { data: couponsRaw } = await admin
    .from('coupons')
    .select('id, code, discount_type, discount_value')
    .eq('is_active', true)
    .is('deleted_at', null)
    .lte('valid_from', now)
    .gte('valid_until', now)
    .order('created_at', { ascending: false })
    .limit(5)

  if (!couponsRaw || couponsRaw.length === 0) return base

  const coupon = couponsRaw[0] as CouponRow
  const discountLabel =
    coupon.discount_type === 'percentage'
      ? `${coupon.discount_value}% 할인`
      : `${Number(coupon.discount_value).toLocaleString()}원 할인`

  return {
    ...base,
    coupon_id: coupon.id,
    discount_label: discountLabel,
    approval_status: 'pending',
    // action_url 없음 — 관리자 승인 전에는 고객 CTA 비활성
  }
}
