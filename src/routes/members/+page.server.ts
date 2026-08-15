import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { PageServerLoad } from './$types'
import type { SubscriptionPlanRow } from '$lib/types/subscription'
import type { SubscriptionPolicyItem } from '$lib/types/database'

export const load: PageServerLoad = async () => {
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return { plans: [] as SubscriptionPlanRow[], policyItems: [] as SubscriptionPolicyItem[] }

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const { data, error } = await admin
    .from('subscription_plans')
    .select('id, name, description, tagline, image_url, image_urls, monthly_price, membership_grade, sort_order, status, features, deleted_at, created_at')
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true })

  if (error) {
    console.error('[members/load]', error)
    return { plans: [] as SubscriptionPlanRow[], policyItems: [] as SubscriptionPolicyItem[] }
  }

  const plans: SubscriptionPlanRow[] = (data ?? []).map((r) => ({
    ...r,
    features: Array.isArray(r.features) ? r.features : [],
  })) as SubscriptionPlanRow[]

  const { data: policyItemRows } = await admin
    .from('subscription_policy_items')
    .select('id, content, sort_order, created_at, updated_at')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  return { plans, policyItems: (policyItemRows ?? []) as SubscriptionPolicyItem[] }
}
