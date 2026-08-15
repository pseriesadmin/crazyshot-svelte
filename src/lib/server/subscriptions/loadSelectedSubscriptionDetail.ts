import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContentBlock } from '$lib/types/content-editor'
import type {
  SelectedSubscriptionDetail,
  SubscriptionPlanRow,
  TierBenefitRow,
  FreeRentalItemRow,
  SubscriberRow,
} from '$lib/types/subscription'

interface PlanRawRow {
  id: number
  name: string
  description: string | null
  tagline: string | null
  image_url: string | null
  image_urls: string[] | null
  content_blocks: unknown
  monthly_price: number
  membership_grade: string | null
  sort_order: number
  category: string | null
  product_code: string | null
  code_series: { prefix?: string } | null
  status: string
  features: unknown
  deleted_at: string | null
  created_at: string
}

function normalizeFeatures(features: unknown): { label: string; value: string }[] {
  if (!Array.isArray(features)) return []
  return features
    .filter((f): f is { label: unknown; value: unknown } => typeof f === 'object' && f !== null)
    .map((f) => ({ label: String(f.label ?? ''), value: String(f.value ?? '') }))
    .filter((f) => f.label !== '')
}

export async function loadSelectedSubscriptionDetail(
  admin: SupabaseClient,
  planId: number
): Promise<SelectedSubscriptionDetail | null> {
  const { data: planRow, error: planError } = await admin
    .from('subscription_plans')
    .select('id, name, description, tagline, image_url, image_urls, content_blocks, monthly_price, membership_grade, sort_order, category, product_code, code_series, status, features, deleted_at, created_at')
    .eq('id', planId)
    .maybeSingle<PlanRawRow>()

  if (planError || !planRow) return null

  const plan: SubscriptionPlanRow = {
    ...planRow,
    features: normalizeFeatures(planRow.features),
    image_urls: planRow.image_urls ?? [],
    content_blocks: Array.isArray(planRow.content_blocks) ? (planRow.content_blocks as ContentBlock[]) : [],
  }

  const { data: benefitRows } = await admin
    .from('tier_benefits')
    .select('id, plan_id, benefit_type, is_enabled, benefit_params')
    .eq('plan_id', planId)

  const benefits = (benefitRows ?? []) as TierBenefitRow[]

  const benefitIds = benefits.map((b) => b.id)
  let freeRentalItems: FreeRentalItemRow[] = []
  if (benefitIds.length > 0) {
    const { data: itemRows } = await admin
      .from('free_rental_items')
      .select('id, tier_benefit_id, product_id, products(name)')
      .in('tier_benefit_id', benefitIds)

    freeRentalItems = (itemRows ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      tier_benefit_id: r.tier_benefit_id as string,
      product_id: r.product_id as string,
      product_name: (r.products as { name: string } | null)?.name ?? null,
    }))
  }

  const { data: subRows } = await admin
    .from('user_subscriptions')
    .select('id, user_id, status, product_code, started_at, user_profiles(email)')
    .eq('plan_id', planId)
    .order('created_at', { ascending: false })

  const subscriberCounts = { active: 0, cancelled: 0, expired: 0 }
  const subscribers: SubscriberRow[] = []
  for (const row of (subRows ?? []) as unknown as Array<{
    id: number
    user_id: string
    status: string
    product_code: string | null
    started_at: string | null
    user_profiles: { email: string | null } | null
  }>) {
    if (row.status === 'active') subscriberCounts.active++
    else if (row.status === 'cancelled') subscriberCounts.cancelled++
    else if (row.status === 'expired') subscriberCounts.expired++

    subscribers.push({
      id: row.id,
      user_id: row.user_id,
      status: row.status,
      product_code: row.product_code,
      started_at: row.started_at,
      email: row.user_profiles?.email ?? null,
    })
  }

  return { plan, benefits, freeRentalItems, subscriberCounts, subscribers }
}
