// src/lib/server/chatActionEnrich.ts
// AC-1: intent/action_card.type별 실데이터 조회 후처리 (AI 파이프라인 전용)
//
// AI(Claude)는 action_card.type(의도 분류 결과)만 결정한다.
// 서버가 type별로 DB를 조회해 ActionPayload의 세부 필드(product_name·product_price·
// reservation_no·action_url 등)를 채우는 후처리 단계.
//
// 조회 실패 / 데이터 없음 → type + is_expired:false만 있는 기본 페이로드로 폴백 (크래시 없음).
// 지원 타입: PRODUCT_CARD, RESERVATION_STATUS_CARD — 나머지는 기본 페이로드 반환.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ActionPayload } from '$lib/types/chat'

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
