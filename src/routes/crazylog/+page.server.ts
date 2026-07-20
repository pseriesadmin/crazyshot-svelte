import type { PageServerLoad } from './$types'

type PostRow = {
	id: string
	title: string
	log_type: string | null
	content_blocks: unknown
	created_at: string
	user_id: string
}

type ProfileRow = {
	id: string
	full_name: string | null
}

function extractFirstImageUrl(blocks: unknown): string | null {
	if (!Array.isArray(blocks)) return null
	for (const block of blocks) {
		const b = block as Record<string, unknown>
		if (b.type === 'image' && Array.isArray(b.images) && b.images.length > 0) {
			const img = b.images[0] as { url?: string }
			if (img.url) return img.url
		}
	}
	return null
}

function extractFirstText(blocks: unknown): string {
	if (!Array.isArray(blocks)) return ''
	for (const block of blocks) {
		const b = block as Record<string, unknown>
		if (b.type === 'text' && typeof b.html === 'string') {
			return b.html.replace(/<[^>]*>/g, '').trim().slice(0, 120)
		}
	}
	return ''
}

function shuffleArray<T>(arr: T[]): T[] {
	const a = [...arr]
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1))
		;[a[i], a[j]] = [a[j], a[i]]
	}
	return a
}

const BAR_COLORS: Record<string, string> = {
	'상품리뷰': '#ff3535',
	'일상공유': '#553fe0',
	'채널홍보': '#3b2f8a',
}

export const load: PageServerLoad = async ({ locals }) => {
	const [reviewCount, shareCount, promoCount, { data: rawAny, error }] = await Promise.all([
		locals.supabase
			.from('user_posts')
			.select('id', { count: 'exact', head: true })
			.eq('status', 'published')
			.eq('is_public', true)
			.eq('log_type', '상품리뷰'),
		locals.supabase
			.from('user_posts')
			.select('id', { count: 'exact', head: true })
			.eq('status', 'published')
			.eq('is_public', true)
			.eq('log_type', '일상공유'),
		locals.supabase
			.from('user_posts')
			.select('id', { count: 'exact', head: true })
			.eq('status', 'published')
			.eq('is_public', true)
			.eq('log_type', '채널홍보'),
		// 최신 30개 취득 후 랜덤 셔플 → 10개 슬라이스
		locals.supabase
			.from('user_posts')
			.select('id, title, log_type, content_blocks, created_at, user_id')
			.eq('status', 'published')
			.eq('is_public', true)
			.order('created_at', { ascending: false })
			.limit(30),
	])

	if (error) console.error('[crazylog] posts query error:', error)

	const rawPosts = (rawAny ?? []) as PostRow[]
	const shuffled = shuffleArray(rawPosts).slice(0, 10)

	const userIds = [...new Set(shuffled.map(p => p.user_id).filter(Boolean))]
	const authorMap: Record<string, string> = {}
	if (userIds.length > 0) {
		const { data: profilesAny } = await locals.supabase
			.from('user_profiles')
			.select('id, full_name')
			.in('id', userIds)
		for (const profile of (profilesAny ?? []) as ProfileRow[]) {
			if (profile.id) authorMap[profile.id] = profile.full_name ?? '익명'
		}
	}

	const posts = shuffled.map((p, i) => ({
		id:        p.id,
		title:     p.title,
		logType:   p.log_type ?? '',
		createdAt: p.created_at,
		author:    authorMap[p.user_id] ?? '익명',
		img:       extractFirstImageUrl(p.content_blocks) ?? null,
		bar:       BAR_COLORS[p.log_type ?? ''] ?? '#3b2f8a',
		rounded:   i % 2 === 0,
	}))

	return {
		counts: {
			review: reviewCount.count ?? 0,
			share:  shareCount.count  ?? 0,
			promo:  promoCount.count  ?? 0,
		},
		posts,
	}
}
