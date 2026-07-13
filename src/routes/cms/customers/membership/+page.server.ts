import { redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import type { PageServerLoad } from './$types'

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
}

export const load: PageServerLoad = async ({ parent, url }) => {
  const { cmsRole } = await parent()
  if (!hasSettingsAccess(cmsRole ?? '')) throw redirect(303, '/cms?notice=access_denied')

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    return {
      subscriptions: [] as SubscriptionRow[],
      stats: { easy: 0, pop: 0, crazy: 0 },
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

  const { data, error } = await query.limit(200)

  if (error) {
    console.error('[membership/load]', error)
    return {
      subscriptions: [] as SubscriptionRow[],
      stats: { easy: 0, pop: 0, crazy: 0 },
      planNames: [] as string[],
      filterPlan,
      filterStatus,
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
    }
  })

  // plan 이름 필터 적용 (클라이언트 사이드 필터)
  const filtered = filterPlan
    ? rows.filter(r => (r.plan_name ?? '').toLowerCase() === filterPlan.toLowerCase())
    : rows

  // 활성 구독 KPI — plan_name 기반
  const statsRows = filterStatus === 'active'
    ? filtered
    : rows.filter(r => r.status === 'active')

  const stats = { easy: 0, pop: 0, crazy: 0 }
  for (const row of statsRows) {
    const n = (row.plan_name ?? '').toLowerCase()
    if (n === 'easy')  stats.easy++
    else if (n === 'pop')   stats.pop++
    else if (n === 'crazy') stats.crazy++
  }

  // 고유 플랜 이름 목록 (필터 칩용)
  const planNames = [...new Set(rows.map(r => r.plan_name).filter(Boolean))] as string[]

  return { subscriptions: filtered, stats, planNames, filterPlan, filterStatus }
}
