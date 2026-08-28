import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { PageServerLoad } from './$types'
import type { SubscriptionPlanRow, TierBenefitRow } from '$lib/types/subscription'
import type { SubscriptionPolicyItem } from '$lib/types/database'
import { formatBenefitForDisplay } from '$lib/utils/subscriptionBenefits'

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

  const planRows = (data ?? []) as { id: number; features: unknown }[]
  const planIds = planRows.map((p) => p.id)

  // CMS '혜택관리'(tier_benefits)는 '상품 스펙'(features)과 별개 테이블이라, 지금까지
  // /members 'Plans & features' 표에는 상품 스펙만 반영되고 혜택관리 설정은 전혀 반영되지
  // 않고 있었음(2026-08-20 확인) — 활성화된 혜택을 라벨/값으로 변환해 features에 병합해
  // 표에 함께 노출한다. DB에는 저장하지 않고 표시 시점에만 병합(두 CMS 탭은 계속 독립 관리).
  const { data: benefitRows } = planIds.length > 0
    ? await admin
        .from('tier_benefits')
        .select('plan_id, benefit_type, is_enabled, benefit_params')
        .in('plan_id', planIds)
        .eq('is_enabled', true)
    : { data: [] as TierBenefitRow[] }

  const benefitsByPlan = new Map<number, { label: string; value: string }[]>()
  for (const b of (benefitRows ?? []) as TierBenefitRow[]) {
    const row = formatBenefitForDisplay(b.benefit_type, b.benefit_params)
    const list = benefitsByPlan.get(b.plan_id) ?? []
    list.push(row)
    benefitsByPlan.set(b.plan_id, list)
  }

  const plans: SubscriptionPlanRow[] = (data ?? []).map((r) => ({
    ...r,
    features: [
      ...(Array.isArray(r.features) ? r.features : []),
      ...(benefitsByPlan.get(r.id) ?? []),
    ],
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
