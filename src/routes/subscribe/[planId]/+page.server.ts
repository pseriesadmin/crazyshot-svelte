import { redirect, error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import type { TierBenefitRow } from '$lib/types/subscription'
import { formatBenefitForDisplay } from '$lib/utils/subscriptionBenefits'

// database.ts 자동생성 타입이 신규 subscription_plans 컬럼 조합을 아직 좁은 select에서
// 정확히 추론하지 못해(narrow-select 시 never로 축소되는 postgrest-js 타입 추론 이슈) 명시적으로 캐스팅
interface PlanFeature {
  label: string
  value: string
}

interface SubscribePlanRow {
  id: number
  name: string
  description: string | null
  tagline: string | null
  image_url: string | null
  image_urls: string[] | null
  content_blocks: unknown
  monthly_price: number
  membership_grade: string | null
  features: unknown
}

export const load: PageServerLoad = async ({ params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, `/login?returnTo=${encodeURIComponent(`/subscribe/${params.planId}`)}`)

  const planId = Number(params.planId)
  if (!Number.isFinite(planId)) throw error(404, '구독 상품을 찾을 수 없습니다')

  const { data: planData } = await locals.supabase
    .from('subscription_plans')
    .select('id, name, description, tagline, image_url, image_urls, content_blocks, monthly_price, membership_grade, features')
    .eq('id', planId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .maybeSingle()

  const plan = planData as SubscribePlanRow | null
  if (!plan) throw error(404, '구독 상품을 찾을 수 없습니다')

  // /members FeaturesTable과 동일한 방식 — 전 플랜의 라벨 합집합을 기준으로 이 플랜의
  // 제공 여부를 행 단위로 구성(이 플랜에 없는 항목은 '—'로 표시해 /members 표와 형식 통일)
  const { data: allPlansData } = await locals.supabase
    .from('subscription_plans')
    .select('id, features')
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true })

  const allPlans = (allPlansData ?? []) as { id: number; features: unknown }[]
  const allPlanIds = allPlans.map((p) => p.id)

  // CMS '혜택관리'(tier_benefits)는 '상품 스펙'(features)과 별개 테이블이라 이 표에도
  // 상품 스펙만 반영되고 혜택관리 설정은 반영되지 않고 있었음(2026-08-20 확인, /members와
  // 동일 결함) — 활성화된 혜택을 라벨/값으로 변환해 features에 병합해 함께 노출한다.
  const { data: benefitRows } = allPlanIds.length > 0
    ? await locals.supabase
        .from('tier_benefits')
        .select('plan_id, benefit_type, is_enabled, benefit_params')
        .in('plan_id', allPlanIds)
        .eq('is_enabled', true)
    : { data: [] as TierBenefitRow[] }

  const benefitsByPlan = new Map<number, PlanFeature[]>()
  for (const b of (benefitRows ?? []) as TierBenefitRow[]) {
    const row = formatBenefitForDisplay(b.benefit_type, b.benefit_params)
    const list = benefitsByPlan.get(b.plan_id) ?? []
    list.push(row)
    benefitsByPlan.set(b.plan_id, list)
  }

  const labels: string[] = []
  for (const p of allPlans) {
    const feats = [
      ...(Array.isArray(p.features) ? (p.features as PlanFeature[]) : []),
      ...(benefitsByPlan.get(p.id) ?? []),
    ]
    for (const f of feats) {
      if (!labels.includes(f.label)) labels.push(f.label)
    }
  }
  const thisFeats = [
    ...(Array.isArray(plan.features) ? (plan.features as PlanFeature[]) : []),
    ...(benefitsByPlan.get(plan.id) ?? []),
  ]
  const featureRows: PlanFeature[] = labels.map((label) => ({
    label,
    value: thisFeats.find((f) => f.label === label)?.value ?? '—',
  }))

  return {
    plan,
    featureRows,
    customerKey: session.user.id,
    customerEmail: session.user.email ?? '',
  }
}
