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

  return { success: chargeSucceeded, nextStatus: result.next_status }
}
