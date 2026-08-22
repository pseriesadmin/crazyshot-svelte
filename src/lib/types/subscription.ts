import type { BenefitType } from '$lib/utils/subscriptionBenefits'
import type { ContentBlock } from '$lib/types/content-editor'

export type { ContentBlock }

export interface SubscriptionPlanRow {
  id: number
  name: string
  description: string | null
  tagline: string | null
  image_url: string | null
  image_urls?: string[]
  content_blocks?: ContentBlock[]
  monthly_price: number
  membership_grade: string | null
  sort_order: number
  is_popular: boolean
  category: string | null
  product_code: string | null
  code_series: { prefix?: string } | null
  status: string
  features: { label: string; value: string }[]
  deleted_at: string | null
  created_at: string
}

export interface SubscriberRow {
  id: number
  user_id: string
  status: string
  product_code: string | null
  started_at: string | null
  email: string | null
}

export interface TierBenefitRow {
  id: string
  plan_id: number
  benefit_type: BenefitType
  is_enabled: boolean
  benefit_params: Record<string, number | string | boolean>
}

export interface FreeRentalItemRow {
  id: string
  tier_benefit_id: string
  product_id: string
  product_name: string | null
}

export interface SubscriberCounts {
  active: number
  cancelled: number
  expired: number
}

export interface SelectedSubscriptionDetail {
  plan: SubscriptionPlanRow
  benefits: TierBenefitRow[]
  freeRentalItems: FreeRentalItemRow[]
  subscriberCounts: SubscriberCounts
  subscribers: SubscriberRow[]
}

export interface SubscriptionPaymentLogRow {
  id: string
  user_subscription_id: number
  plan_id: number
  amount: number
  status: string
  billed_at: string
}
