import type { PageServerLoad } from './$types'

export type AnalyticsData = {
  total_revenue: number
  conversion_rate: number
  ctr: number
  active_campaigns: number
  top_coupons: Array<{
    coupon_code: string
    used_count: number
    issued_count: number
    conversion: number
  }>
  segment_performance: Array<{
    segment: string
    user_count: number
    avg_score: number
  }>
}

export type BannerStats = Record<string, { clicks: number }>

export const load: PageServerLoad = async ({ locals }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = locals.supabase as unknown as any

  const { data: analyticsRaw } = await db.rpc('get_promotion_analytics')

  const analytics: AnalyticsData = analyticsRaw ?? {
    total_revenue: 0,
    conversion_rate: 0,
    ctr: 0,
    active_campaigns: 0,
    top_coupons: [],
    segment_performance: [],
  }

  // 배너 슬롯별 클릭 집계
  const { data: bannerEvents } = await locals.supabase
    .from('user_behavior_events')
    .select('event_data')
    .eq('event_type', 'click')
    .not('event_data->slot_key', 'is', null)

  const bannerStats: BannerStats = {}
  for (const ev of (bannerEvents ?? []) as Array<{ event_data: Record<string, unknown> }>) {
    const slot = ev.event_data?.slot_key as string | undefined
    if (slot) {
      // eslint-disable-next-line security/detect-object-injection
      const cur = bannerStats[slot]
      // eslint-disable-next-line security/detect-object-injection
      bannerStats[slot] = { clicks: (cur?.clicks ?? 0) + 1 }
    }
  }

  // 전체 페이지뷰 수
  const { data: pageviews } = await locals.supabase
    .from('user_behavior_events')
    .select('event_data')
    .eq('event_type', 'pageview')

  const totalPageviews = (pageviews ?? []).length

  return {
    analytics,
    bannerStats,
    totalPageviews,
  }
}
