/**
 * consumeCoupons.ts — 결제확정 시점 다중쿠폰 소진 공용 헬퍼
 *
 * 배경: 쿠폰 다중중첩 체크아웃 구조 전환(Migration #531~534)으로 장바구니는 여러 쿠폰을
 * 동시에 선택할 수 있게 됐으나, 실제 결제 확정 3곳(confirm-mock/pay-mock/pay-result)은
 * 여전히 단일 use_coupon RPC만 호출하고 있었다 — 이 헬퍼가 그 3곳을 use_coupons(Migration
 * #532, all-or-nothing) 호출로 통일한다. 동일 로직을 3곳에 각각 인라인 구현하면 이미
 * products.md §2-3류 사례처럼 "한 곳만 고치고 나머지 누락" 결함이 재발하기 쉬워 단일
 * 정본으로 추출했다.
 *
 * 반환 shape은 기존 단일쿠폰 시절의 {couponUsed, couponRedeemedCode, couponError}를
 * 그대로 유지한다 — 호출부(및 클라이언트의 COUPON_ERR_MSG 매핑)를 변경하지 않기 위함.
 * redeemedCode는 sequenced 모드 쿠폰이 1장이라도 있으면 그중 첫 값을 반환한다(여러 장이어도
 * 화면엔 문자열 1개만 표시하므로 충분 — contract/[token]/+page.svelte 참고).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface ConsumeCouponsResult {
  couponUsed: boolean
  couponRedeemedCode: string | null
  couponError: string | null
}

interface UseCouponsRpcResult {
  ok: boolean
  error?: string
  results?: { user_coupon_id: string; ok: boolean; redeemed_code?: string | null }[]
}

// use_coupons(Migration #532)는 all-or-nothing 실패 시
// 'COUPON_STACK_REJECTED:<user_coupon_id>:<code>' 형태의 예외를 던진다 — <code> 부분만
// 추출해 기존 단일쿠폰 COUPON_ERR_MSG 매핑(MIN_AMOUNT_NOT_MET 등)을 그대로 재사용한다.
const STACK_REJECTED_RE = /COUPON_STACK_REJECTED:[^:]+:(.+)$/

export async function consumeSelectedCoupons(
  admin: SupabaseClient,
  userId: string,
  orderId: number | string | null,
  userCouponIds: string[],
): Promise<ConsumeCouponsResult> {
  if (userCouponIds.length === 0) {
    return { couponUsed: false, couponRedeemedCode: null, couponError: null }
  }

  const { data, error } = await admin.rpc('use_coupons', {
    p_user_id: userId,
    p_order_id: orderId,
    p_user_coupon_ids: userCouponIds,
  })

  if (error) {
    const match = STACK_REJECTED_RE.exec(error.message ?? '')
    return {
      couponUsed: false,
      couponRedeemedCode: null,
      couponError: match?.[1] ?? error.message ?? 'UNKNOWN',
    }
  }

  const result = data as UseCouponsRpcResult | null
  if (!result?.ok) {
    return { couponUsed: false, couponRedeemedCode: null, couponError: result?.error ?? 'UNKNOWN' }
  }

  const redeemedCode = (result.results ?? [])
    .map((r) => r.redeemed_code ?? null)
    .find((c) => c !== null) ?? null

  return { couponUsed: true, couponRedeemedCode: redeemedCode, couponError: null }
}
