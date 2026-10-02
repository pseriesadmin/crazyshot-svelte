import type { PageServerLoad } from './$types'

export interface FaqItem {
	id: string
	title: string
	content: string
	help_category: string
}

export interface HeroImageItem {
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

	// canned_responses는 cr_read 정책(FOR SELECT USING (true))으로 anon 공개 조회 가능
	const { data: faqData } = await locals.supabase
		.from('canned_responses')
		.select('id, title, content, help_category')
		// 미검토(CSV 일괄등록 등 pending_review=true) 항목은 고객 도움말에 노출 금지 — CMS 관리자 세션은
		// RLS(cr_admin_all)로 전체가 조회되므로 RLS와 별개로 앱 쿼리에서도 반드시 제외한다.
		.eq('pending_review', false)
		.order('usage_count', { ascending: false })
		.order('title', { ascending: true })

	const faqItems = (faqData ?? []) as FaqItem[]

	// 도움말 히어로 배경 이미지 설정
	const { data: heroBgSettingRow } = await locals.supabase
		.from('cms_settings')
		.select('value')
		.eq('key', 'help_hero_bg_images')
		.maybeSingle()

	type HeroBgValue = { images?: HeroImageItem[]; mode?: 'random' | 'fixed'; title?: string; sub?: string }
	const heroBgValue = ((heroBgSettingRow as { value: unknown } | null)?.value ?? {}) as HeroBgValue
	const heroBgImages: HeroImageItem[] = heroBgValue.images ?? []
	const heroBgMode: 'random' | 'fixed' = heroBgValue.mode ?? 'random'

	let heroBgUrl = '/help/hero-bg.png'
	if (heroBgImages.length > 0) {
		if (heroBgMode === 'random') {
			heroBgUrl = heroBgImages[Math.floor(Math.random() * heroBgImages.length)].url
		} else {
			heroBgUrl = heroBgImages[0].url
		}
	}

	// 메인·서브 문구(CMS 히어로 관리) — 없으면 기본 문구
	const heroTitle = (heroBgValue.title ?? '').trim()
	const heroSub = (heroBgValue.sub ?? '').trim()

	return { isCms, faqItems, heroBgImages, heroBgMode, heroBgUrl, heroTitle, heroSub }
}
