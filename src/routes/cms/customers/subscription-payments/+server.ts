import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import type { RequestHandler } from './$types'

// GET /cms/customers/subscription-payments?userSubscriptionId=<user_subscriptions.id>
// CMS 관리자 전용(manager 이상): 특정 구독의 결제(청구) 이력 조회 — subscription_payment_logs는
// 금액을 포함한 민감정보라 형제 엔드포인트(/cms/customers/subscriptions)보다 한 단계 강화된
// 게이트를 사용한다(/cms/subscriptions 모듈 전체와 동일 기준).
export const GET: RequestHandler = async ({ locals, url }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '인증 필요' }, { status: 403 })

  const cmsRole = await getCmsRoleForAction(locals)
  if (!hasSettingsAccess(cmsRole ?? '')) return json({ error: '권한 없음' }, { status: 403 })

  const userSubscriptionId = Number(url.searchParams.get('userSubscriptionId'))
  if (!Number.isFinite(userSubscriptionId) || userSubscriptionId <= 0) {
    return json({ error: 'userSubscriptionId 필수' }, { status: 400 })
  }

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const { data, error } = await admin
    .from('subscription_payment_logs')
    .select('id, user_subscription_id, plan_id, amount, status, billed_at')
    .eq('user_subscription_id', userSubscriptionId)
    .order('billed_at', { ascending: false })

  if (error) return json({ error: error.message }, { status: 500 })

  return json(data ?? [])
}
