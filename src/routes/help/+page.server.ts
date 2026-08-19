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
		.order('usage_count', { ascending: false })
		.order('title', { ascending: true })

	const faqItems = (faqData ?? []) as FaqItem[]

	// 도움말 히어로 배경 이미지 설정
	const { data: heroBgSettingRow } = await locals.supabase
		.from('cms_settings')
		.select('value')
		.eq('key', 'help_hero_bg_images')
		.maybeSingle()

	type HeroBgValue = { images?: HeroImageItem[]; mode?: 'random' | 'fixed' }
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

	return { isCms, faqItems, heroBgImages, heroBgMode, heroBgUrl }
}
