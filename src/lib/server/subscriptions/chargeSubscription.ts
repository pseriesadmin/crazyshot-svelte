import type { SupabaseClient } from '@supabase/supabase-js'

export interface ChargeSubscriptionInput {
  userSubscriptionId: number
  billingKey: string
  customerKey: string
  amount: number
  orderName: string
  tossSecretKey: string
}

export interface ChargeSubscriptionResult {
  success: boolean
  nextStatus?: string
  error?: string
}

/**
 * TossPayments 빌링(정기결제) 청구 실행 + 결과 기록.
 * /subscribe/success(최초 청구)와 정기청구 크론(Stage 7)이 공유하는 단일 진입점 —
 * 청구 로직을 두 곳에 중복 구현하지 않기 위한 목적.
 */
export async function chargeSubscription(
  admin: SupabaseClient,
  input: ChargeSubscriptionInput
): Promise<ChargeSubscriptionResult> {
  const { userSubscriptionId, billingKey, customerKey, amount, orderName, tossSecretKey } = input

  const orderId = `SUB-${userSubscriptionId}-${Date.now()}`
  const authHeader = 'Basic ' + Buffer.from(`${tossSecretKey}:`).toString('base64')

  async function callTossBillingApi(): Promise<{ ok: boolean; body: unknown }> {
    try {
      const res = await fetch(`https://api.tosspayments.com/v1/billing/${billingKey}`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ customerKey, amount, orderId, orderName }),
      })
      return { ok: res.ok, body: await res.json() }
    } catch (err) {
      return { ok: false, body: { error: err instanceof Error ? err.message : 'unknown fetch error' } }
    }
  }

  const { ok: chargeSucceeded, body: tossResponse } = await callTossBillingApi()

  const { data, error } = await admin.rpc('record_subscription_charge_result', {
    p_user_subscription_id: userSubscriptionId,
    p_status: chargeSucceeded ? 'succeeded' : 'failed',
    p_amount: amount,
    p_toss_response: tossResponse,
  })

  if (error) return { success: false, error: error.message }

  const result = data as { success: boolean; next_status?: string; error?: string }
  if (!result.success) return { success: false, error: result.error }

  if (chargeSucceeded) {
    // 구독 혜택 "할인쿠폰" 자동발급 — fail-soft(발급 실패가 결제 성공 결과를 되돌리지 않음).
    // /subscribe/success(최초가입)와 정기청구 크론 양쪽에 자동 적용되는 단일 지점.
    try {
      const { error: benefitError } = await admin.rpc('issue_subscription_benefit_coupon', {
        p_user_subscription_id: userSubscriptionId,
      })
      if (benefitError) {
        console.error('구독 혜택 할인쿠폰 발급 RPC 실패:', benefitError.message)
      }
    } catch (err) {
      console.error('구독 혜택 할인쿠폰 발급 중 예외:', err instanceof Error ? err.message : err)
    }

    // 구독 혜택 "적립포인트" 자동적립 — 위 쿠폰발급과 독립적으로 각자 fail-soft 처리
    // (하나가 실패해도 다른 하나·결제결과에 영향 없음).
    try {
      const { error: pointsError } = await admin.rpc('award_subscription_points', {
        p_user_subscription_id: userSubscriptionId,
        p_amount: amount,
      })
      if (pointsError) {
        console.error('구독 혜택 적립포인트 지급 RPC 실패:', pointsError.message)
      }
    } catch (err) {
      console.error('구독 혜택 적립포인트 지급 중 예외:', err instanceof Error ? err.message : err)
    }
  }

  return { success: chargeSucceeded, nextStatus: result.next_status }
}
