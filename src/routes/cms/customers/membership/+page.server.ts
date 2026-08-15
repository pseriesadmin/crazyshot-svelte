import { redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import type { PageServerLoad } from './$types'

export interface SubscriptionPaymentSummary {
  amount: number
  status: string
  billed_at: string
}

export interface SubscriptionRow {
  id: string
  user_id: string
  plan_id: number | null
  plan_name: string | null
  status: string
  started_at: string | null
  expires_at: string | null
  cancelled_at: string | null
  created_at: string
  user_name: string | null
  user_email: string | null
  user_credit_score: number | null
  user_membership_grade: string | null
  last_payment: SubscriptionPaymentSummary | null
}

export interface PlanKpi {
  plan_id: number
  name: string
  monthly_price: number
  membership_grade: string | null
  activeCount: number
}

export const load: PageServerLoad = async ({ parent, url }) => {
  const { cmsRole } = await parent()
  if (!hasSettingsAccess(cmsRole ?? '')) throw redirect(303, '/cms?notice=access_denied')

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    return {
      subscriptions: [] as SubscriptionRow[],
      planKpis: [] as PlanKpi[],
      planNames: [] as string[],
      filterPlan: '',
      filterStatus: '',
    }
  }

  const filterPlan   = url.searchParams.get('plan')   ?? ''
  const filterStatus = url.searchParams.get('status') ?? 'active'

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  let query = admin
    .from('user_subscriptions')
    .select(`
      id, user_id, plan_id, status, started_at, expires_at, cancelled_at, created_at,
      subscription_plans!plan_id(name),
      user_profiles!user_id(full_name, email, credit_score, membership_grade)
    `)
    .order('created_at', { ascending: false })

  if (filterStatus) query = query.eq('status', filterStatus)

  const [{ data, error }, { data: planRows }, { data: activePlanIdRows }] = await Promise.all([
    query.limit(200),
    admin
      .from('subscription_plans')
      .select('id, name, monthly_price, membership_grade')
      .eq('status', 'active')
      .is('deleted_at', null)
      .order('sort_order', { ascending: true }),
    // KPI는 테이블의 status 필터와 무관하게 항상 "현재 활성 구독자 수"를 보여줘야 하므로 별도 조회
    admin.from('user_subscriptions').select('plan_id').eq('status', 'active'),
  ])

  if (error) {
    console.error('[membership/load]', error)
    return {
      subscriptions: [] as SubscriptionRow[],
      planKpis: [] as PlanKpi[],
      planNames: [] as string[],
      filterPlan,
      filterStatus,
    }
  }

  const subscriptionIds = (data ?? []).map((r: Record<string, unknown>) => Number(r.id))
  const lastPaymentBySubId = new Map<number, SubscriptionPaymentSummary>()
  if (subscriptionIds.length > 0) {
    const { data: paymentRows } = await admin
      .from('subscription_payment_logs')
      .select('user_subscription_id, amount, status, billed_at')
      .in('user_subscription_id', subscriptionIds)
      .order('billed_at', { ascending: false })
    for (const p of (paymentRows ?? []) as Record<string, unknown>[]) {
      const subId = p.user_subscription_id as number
      if (!lastPaymentBySubId.has(subId)) {
        lastPaymentBySubId.set(subId, {
          amount:    p.amount as number,
          status:    p.status as string,
          billed_at: p.billed_at as string,
        })
      }
    }
  }

  const rows: SubscriptionRow[] = (data ?? []).map((r: Record<string, unknown>) => {
    const plan = r.subscription_plans as Record<string, unknown> | null
    const up   = r.user_profiles    as Record<string, unknown> | null
    return {
      id:                   String(r.id),
      user_id:              r.user_id as string,
      plan_id:              r.plan_id as number | null,
      plan_name:            plan?.name as string | null,
      status:               r.status as string,
      started_at:           r.started_at as string | null,
      expires_at:           r.expires_at as string | null,
      cancelled_at:         r.cancelled_at as string | null,
      created_at:           r.created_at as string,
      user_name:            up?.full_name as string | null,
      user_email:           up?.email     as string | null,
      user_credit_score:    up?.credit_score    as number | null,
      user_membership_grade: up?.membership_grade as string | null,
      last_payment:         lastPaymentBySubId.get(Number(r.id)) ?? null,
    }
  })

  // plan 이름 필터 적용 (클라이언트 사이드 필터)
  const filtered = filterPlan
    ? rows.filter(r => (r.plan_name ?? '').toLowerCase() === filterPlan.toLowerCase())
    : rows

  // 등록된 활성 구독 상품 카드 — membership_grade 기준 실집계(plan_name 문자열 매칭 아님)
  const activeCountByPlan = new Map<number, number>()
  for (const r of (activePlanIdRows ?? []) as { plan_id: number | null }[]) {
    if (r.plan_id == null) continue
    activeCountByPlan.set(r.plan_id, (activeCountByPlan.get(r.plan_id) ?? 0) + 1)
  }
  const planKpis: PlanKpi[] = (planRows ?? []).map((p: Record<string, unknown>) => ({
    plan_id:          p.id as number,
    name:             p.name as string,
    monthly_price:    p.monthly_price as number,
    membership_grade: p.membership_grade as string | null,
    activeCount:      activeCountByPlan.get(p.id as number) ?? 0,
  }))

  // 고유 플랜 이름 목록 (필터 칩용)
  const planNames = [...new Set(rows.map(r => r.plan_name).filter(Boolean))] as string[]

  return { subscriptions: filtered, planKpis, planNames, filterPlan, filterStatus }
}
