import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
  const { session } = await locals.safeGetSession()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: trendingRaw } = await (locals.supabase.rpc as any)(
    'get_trending_keywords', { p_limit: 6, p_days: 7 }
  )
  const trendingKeywords: string[] = Array.isArray(trendingRaw)
    ? (trendingRaw as string[]).filter(Boolean)
    : []
  return { trendingKeywords, isLoggedIn: !!session?.user.id }
}
