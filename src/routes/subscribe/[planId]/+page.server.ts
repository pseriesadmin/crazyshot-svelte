import { redirect, error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

// database.ts 자동생성 타입이 신규 subscription_plans 컬럼 조합을 아직 좁은 select에서
// 정확히 추론하지 못해(narrow-select 시 never로 축소되는 postgrest-js 타입 추론 이슈) 명시적으로 캐스팅
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
}

export const load: PageServerLoad = async ({ params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, `/login?returnTo=${encodeURIComponent(`/subscribe/${params.planId}`)}`)

  const planId = Number(params.planId)
  if (!Number.isFinite(planId)) throw error(404, '구독 상품을 찾을 수 없습니다')

  const { data: planData } = await locals.supabase
    .from('subscription_plans')
    .select('id, name, description, tagline, image_url, image_urls, content_blocks, monthly_price, membership_grade')
    .eq('id', planId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .maybeSingle()

  const plan = planData as SubscribePlanRow | null
  if (!plan) throw error(404, '구독 상품을 찾을 수 없습니다')

  return {
    plan,
    customerKey: session.user.id,
    customerEmail: session.user.email ?? '',
  }
}
