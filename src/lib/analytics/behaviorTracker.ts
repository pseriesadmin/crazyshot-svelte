/**
 * behaviorTracker.ts — 클라이언트 행동 이벤트 수집 유틸
 * Phase 2 CDP Input Layer
 *
 * 사용법:
 *   import { trackEvent } from '$lib/analytics/behaviorTracker'
 *   trackEvent('pageview', { title: '상품 목록' })
 */

import { supabase } from '$lib/services/supabase'
import { browser } from '$app/environment'

export type BehaviorEventType =
  | 'pageview'
  | 'click'
  | 'search'
  | 'wishlist'
  | 'cart_add'
  | 'purchase'
  | 'coupon_use'
  | 'review'

export interface TrackEventPayload {
  event_type: BehaviorEventType
  event_data?: Record<string, unknown>
  page_path?: string
}

function getSessionId(): string {
  if (!browser) return ''
  const key = 'cs_session_id'
  let id = sessionStorage.getItem(key)
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem(key, id)
  }
  return id
}

function getDeviceType(): 'pc' | 'mobile' {
  if (!browser) return 'pc'
  return window.innerWidth < 768 ? 'mobile' : 'pc'
}

export async function trackEvent(
  eventType: BehaviorEventType,
  eventData?: Record<string, unknown>
): Promise<void> {
  if (!browser) return

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // track_behavior_event RPC는 자동생성 타입 미포함 — bind로 this 보존 후 우회
  const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args: Record<string, unknown>) => Promise<unknown>
  await rpc('track_behavior_event', {
    p_user_id:    user?.id ?? null,
    p_session_id: getSessionId(),
    p_event_type: eventType,
    p_event_data: eventData ?? null,
    p_page_path:  window.location.pathname,
    p_device_type: getDeviceType(),
    p_referrer:   document.referrer || null,
  })
}

export function trackPageView(extraData?: Record<string, unknown>): void {
  trackEvent('pageview', {
    title: browser ? document.title : '',
    ...extraData,
  })
}

export function trackSearch(query: string): void {
  trackEvent('search', { query })
}

export function trackProductView(productId: string, productName?: string): void {
  trackEvent('click', { product_id: productId, product_name: productName, action: 'product_view' })
}

export function trackCartAdd(productId: string, rentalDays?: number): void {
  trackEvent('cart_add', { product_id: productId, rental_days: rentalDays })
}

export function trackWishlist(productId: string): void {
  trackEvent('wishlist', { product_id: productId })
}
