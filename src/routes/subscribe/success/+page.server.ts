import { redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { chargeSubscription } from '$lib/server/subscriptions/chargeSubscription'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ url, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/login')

  const planId = Number(url.searchParams.get('planId'))

  if (!Number.isFinite(planId)) {
    return { success: false, error: '잘못된 접근입니다.' }
  }

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  // 정기결제(빌링, mid=bill_crazyhevr) 전용 시크릿 키 — 단건결제(mid=crazysfc8s)의
  // TOSS_SECRET_KEY와는 서로 다른 상점의 별개 키(공용 아님)
  const tossSecretKey = env.TOSS_BILLING_SECRET_KEY
  if (!serviceRoleKey || !tossSecretKey) {
    return { success: false, error: '서버 설정 오류입니다. 잠시 후 다시 시도해주세요.' }
  }

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const { data: plan } = await admin
    .from('subscription_plans')
    .select('id, name, monthly_price')
    .eq('id', planId)
    .maybeSingle()

  if (!plan) return { success: false, error: '구독 상품을 찾을 수 없습니다.' }

  // authKey → billingKey 교환 (Toss 빌링 인증 완료 콜백)
  const authKey = url.searchParams.get('authKey')
  const customerKey = url.searchParams.get('customerKey')
  if (!authKey || !customerKey) {
    return { success: false, error: '잘못된 접근입니다.' }
  }
  if (customerKey !== session.user.id) {
    return { success: false, error: '요청 정보가 일치하지 않습니다.' }
  }

  const authHeader = 'Basic ' + Buffer.from(`${tossSecretKey}:`).toString('base64')
  const issueRes = await fetch('https://api.tosspayments.com/v1/billing/authorizations/issue', {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ authKey, customerKey }),
  })
  const issueData = await issueRes.json()

  if (!issueRes.ok || !issueData.billingKey) {
    return { success: false, error: '카드 등록에 실패했습니다. 다시 시도해주세요.' }
  }
  const billingKey: string = issueData.billingKey

  const billingCycleDay = new Date().getDate()

  const { data: subResult, error: subError } = await admin.rpc('create_user_subscription', {
    p_user_id: session.user.id,
    p_plan_id: planId,
    p_billing_key: billingKey,
    p_billing_cycle_day: Math.min(billingCycleDay, 28),
  })

  if (subError || !subResult?.success) {
    const errorCode = subResult?.error as string | undefined
    const message =
      errorCode === 'ALREADY_SUBSCRIBED' ? '이미 활성화된 구독이 있습니다.' :
      errorCode === 'PLAN_NOT_FOUND' ? '구독 상품을 찾을 수 없습니다.' :
      '구독 등록에 실패했습니다.'
    return { success: false, error: message }
  }

  const subscriptionId = subResult.subscription_id as number

  // 등록 직후 최초 빌링 청구
  const chargeResult = await chargeSubscription(admin, {
    userSubscriptionId: subscriptionId,
    billingKey,
    customerKey: session.user.id,
    amount: plan.monthly_price,
    orderName: `${plan.name} 정기구독`,
    tossSecretKey: tossSecretKey as string,
  })
  const chargeSucceeded = chargeResult.success
  const paymentMethod = '카드'

  const confirmedAt = new Date().toISOString().replace(/T(\d{2}):(\d{2}).*/, '·$1:$2').replace(/-/g, '.')
  const nextBillingDay = Math.min(billingCycleDay, 28)

  if (!chargeSucceeded) {
    return {
      success: true,
      planName: plan.name,
      monthlyPrice: plan.monthly_price,
      billingCycleDay: nextBillingDay,
      confirmedAt,
      paymentMethod,
      chargeWarning: '카드 등록은 완료됐으나 최초 결제에는 실패했습니다. 다음 청구일에 재시도됩니다.',
    }
  }

  return {
    success: true,
    planName: plan.name,
    monthlyPrice: plan.monthly_price,
    billingCycleDay: nextBillingDay,
    confirmedAt,
    paymentMethod,
    chargeWarning: null,
  }
}
