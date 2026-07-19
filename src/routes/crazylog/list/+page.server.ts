import type { PageServerLoad } from './$types'

// user_posts는 migration #117에서 추가 — supabase gen types 재생성 전까지 로컬 타입 선언
type PostRow = {
	id: string
	title: string
	log_type: string | null
	content_blocks: unknown
	created_at: string
	user_id: string
	thumbnail_url: string | null
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
type ProfileRow = {
	id: string
	full_name: string | null
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const tab = url.searchParams.get('tab') ?? '전체'

	const { session } = await locals.safeGetSession()
	let isLoggedIn = !!session
	let currentUser: { displayName: string; avatarUrl: string | null; membershipGrade: string | null; level: string } | null = null

	if (session) {
		const { data: profile } = await locals.supabase
			.from('user_profiles')
			.select('full_name, avatar_url, membership_grade, credit_score')
			.eq('id', session.user.id)
			.maybeSingle()
		const p = profile as { full_name: string | null; avatar_url: string | null; membership_grade: string | null; credit_score: number | null } | null
		const score = p?.credit_score ?? 0
		const level = score >= 85 ? 'LV.5' : score >= 70 ? 'LV.4' : score >= 50 ? 'LV.3' : score >= 30 ? 'LV.2' : 'LV.1'
		currentUser = {
			displayName:     p?.full_name ?? '익명',
			avatarUrl:       p?.avatar_url ?? null,
			membershipGrade: p?.membership_grade ?? null,
			level,
		}
	}

	// user_posts.user_id → auth.users.id 참조.
	// user_profiles.id도 auth.users.id와 동일(PK = auth UID)이지만
	// user_posts → user_profiles 간 직접 FK가 없어 PostgREST !inner join 불가.
	// → 포스트 조회 후 user_profiles 별도 쿼리로 작성자명 조회.
	let query = locals.supabase
		.from('user_posts')
		.select('id, title, log_type, content_blocks, created_at, user_id, thumbnail_url')
		.eq('status', 'published')
		.eq('is_public', true)
		.order('created_at', { ascending: false })
		.limit(50)

	if (tab === '상품리뷰' || tab === '일상공유' || tab === '채널홍보') {
		query = query.eq('log_type', tab)
	}

	const { data: rawPostsAny, error } = await query
	if (error) console.error('[crazylog/list] posts query error:', error)
	const rawPosts = (rawPostsAny ?? []) as PostRow[]

	// 작성자 이름 별도 조회 (user_profiles.id == user_posts.user_id)
	const userIds = [...new Set(rawPosts.map(p => p.user_id).filter(Boolean))]
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

	const postList = rawPosts.map(p => ({
		id:           p.id,
		title:        p.title,
		logType:      p.log_type ?? '',
		createdAt:    p.created_at,
		author:       authorMap[p.user_id] ?? '익명',
		thumbnailUrl: p.thumbnail_url ?? extractFirstImageUrl(p.content_blocks) ?? null,
	}))

	const [reviewCount, shareCount, promoCount] = await Promise.all([
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
	])

	return {
		posts: postList,
		counts: {
			review: reviewCount.count ?? 0,
			share:  shareCount.count  ?? 0,
			promo:  promoCount.count  ?? 0,
		},
		activeTab: tab,
		isLoggedIn,
		currentUser,
	}
}
