import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { PageServerLoad } from './$types'
import type { SubscriptionPlanRow } from '$lib/types/subscription'
import type { SubscriptionPolicyItem } from '$lib/types/database'

export interface HeroBannerImageItem {
  url: string
  path: string
}

export const load: PageServerLoad = async ({ locals }) => {
  const { session } = await locals.safeGetSession()
  let isCms = false
  if (session?.user.id) {
    const { data: profile } = await locals.supabase
      .from('user_profiles')
      .select('cms_role')
      .eq('id', session.user.id)
      .single()
    isCms = !!(profile as { cms_role?: string | null } | null)?.cms_role
  }

  // 히어로 배너 이미지 설정
  const { data: heroBannerSettingRow } = await locals.supabase
    .from('cms_settings')
    .select('value')
    .eq('key', 'members_hero_banner')
    .maybeSingle()

  type HeroBannerValue = { images?: HeroBannerImageItem[]; mode?: 'random' | 'fixed'; mainCopy?: string; subCopy?: string }
  const heroBannerValue = ((heroBannerSettingRow as { value: unknown } | null)?.value ?? {}) as HeroBannerValue
  const heroBannerImages: HeroBannerImageItem[] = heroBannerValue.images ?? []
  const heroBannerMode: 'random' | 'fixed' = heroBannerValue.mode ?? 'random'
  const heroBannerMainCopy: string = heroBannerValue.mainCopy ?? ''
  const heroBannerSubCopy: string = heroBannerValue.subCopy ?? ''

  let heroBannerUrl = '/members/hero-character.png'
  if (heroBannerImages.length > 0) {
    if (heroBannerMode === 'random') {
      heroBannerUrl = heroBannerImages[Math.floor(Math.random() * heroBannerImages.length)].url
    } else {
      heroBannerUrl = heroBannerImages[0].url
    }
  }

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    return {
      plans: [] as SubscriptionPlanRow[],
      policyItems: [] as SubscriptionPolicyItem[],
      isCms,
      heroBannerImages,
      heroBannerMode,
      heroBannerUrl,
      heroBannerMainCopy,
      heroBannerSubCopy,
    }
  }

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const { data, error } = await admin
    .from('subscription_plans')
    .select('id, name, description, tagline, image_url, image_urls, monthly_price, membership_grade, sort_order, is_popular, status, features, deleted_at, created_at')
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true })

  if (error) {
    console.error('[members/load]', error)
    return {
      plans: [] as SubscriptionPlanRow[],
      policyItems: [] as SubscriptionPolicyItem[],
      isCms,
      heroBannerImages,
      heroBannerMode,
      heroBannerUrl,
      heroBannerMainCopy,
      heroBannerSubCopy,
    }
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

  return {
    plans,
    policyItems: (policyItemRows ?? []) as SubscriptionPolicyItem[],
    isCms,
    heroBannerImages,
    heroBannerMode,
    heroBannerUrl,
    heroBannerMainCopy,
    heroBannerSubCopy,
  }
}
