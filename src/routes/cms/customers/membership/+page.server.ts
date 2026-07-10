import { redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import type { PageServerLoad } from './$types'

export interface SubscriptionRow {
  id: string
  user_id: string
  tier: string
  status: string
  price_per_month: number | null
  billing_cycle_start: string | null
  billing_cycle_end: string | null
  auto_renew: boolean
  cancelled_at: string | null
  cancellation_reason: string | null
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
  if (!serviceRoleKey) return { subscriptions: [] as SubscriptionRow[], stats: { easy: 0, pop: 0, crazy: 0 }, tier: '', status: '' }

  const tier   = url.searchParams.get('tier')   ?? ''
  const status = url.searchParams.get('status') ?? 'active'

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  let query = admin
    .from('subscriptions')
    .select(`
      id, user_id, tier, status, price_per_month,
      billing_cycle_start, billing_cycle_end, auto_renew,
      cancelled_at, cancellation_reason, created_at,
      user_profiles!inner(name, email, credit_score, membership_grade)
    `)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (tier) query = query.eq('tier', tier)
  if (status) query = query.eq('status', status)

  const { data, error } = await query.limit(200)

  if (error) {
    console.error('[membership/load]', error)
    return { subscriptions: [] as SubscriptionRow[], stats: { easy: 0, pop: 0, crazy: 0 }, tier, status }
  }

  const rows: SubscriptionRow[] = (data ?? []).map((r: Record<string, unknown>) => {
    const up = r.user_profiles as Record<string, unknown> | null
    return {
      id: r.id as string,
      user_id: r.user_id as string,
      tier: r.tier as string,
      status: r.status as string,
      price_per_month: r.price_per_month as number | null,
      billing_cycle_start: r.billing_cycle_start as string | null,
      billing_cycle_end: r.billing_cycle_end as string | null,
      auto_renew: r.auto_renew as boolean,
      cancelled_at: r.cancelled_at as string | null,
      cancellation_reason: r.cancellation_reason as string | null,
      created_at: r.created_at as string,
      user_name: up?.name as string | null,
      user_email: up?.email as string | null,
      user_credit_score: up?.credit_score as number | null,
      user_membership_grade: up?.membership_grade as string | null,
    }
  })

  // 활성 구독 KPI
  const { data: activeData } = await admin
    .from('subscriptions')
    .select('tier')
    .eq('status', 'active')
    .is('deleted_at', null)

  const stats = { easy: 0, pop: 0, crazy: 0 }
  for (const row of activeData ?? []) {
    if (row.tier === 'easy')  stats.easy++
    if (row.tier === 'pop')   stats.pop++
    if (row.tier === 'crazy') stats.crazy++
  }

  return { subscriptions: rows, stats, tier, status }
}
