import type { PageServerLoad } from './$types'

type KeywordsSettings = { items: string[] }

export const load: PageServerLoad = async ({ locals }) => {
  const { session } = await locals.safeGetSession()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: trendingRaw } = await (locals.supabase.rpc as any)(
    'get_trending_keywords', { p_limit: 6, p_days: 7 }
  )
  const trendingKeywords: string[] = Array.isArray(trendingRaw)
    ? (trendingRaw as string[]).filter(Boolean)
    : []

  // All(/products) +page.server.ts와 동일 — 트렌딩 없을 때 CMS product_page_keywords 폴백
  const { data: settingsRaw, error: settingsErr } = await locals.supabase.rpc('get_product_page_settings')
  if (settingsErr) {
    console.error('[products/search] get_product_page_settings 실패:', settingsErr.message)
  }
  const settings = ((settingsRaw as unknown) as Record<string, unknown>) ?? {}
  const keywordsSettings = (settings['product_page_keywords'] as KeywordsSettings) ?? { items: [] }
  const cmsKeywords = (keywordsSettings.items ?? []).filter(Boolean)

  const interestKeywords =
    trendingKeywords.length > 0 ? trendingKeywords : cmsKeywords

  return {
    interestKeywords,
    isLoggedIn: !!session?.user.id,
  }
}
