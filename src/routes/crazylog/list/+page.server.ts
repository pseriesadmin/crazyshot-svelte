import type { PageServerLoad } from './$types'
import { resolveGrade } from '$lib/utils/membership'
import { canDeletePost } from '$lib/utils/crazylogPostPermissions'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'

// user_posts는 migration #117에서 추가 — supabase gen types 재생성 전까지 로컬 타입 선언
type PostRow = {
	id: string
	title: string
	log_type: string | null
	content_blocks: unknown
	created_at: string
	user_id: string
	thumbnail_url: string | null
	is_public: boolean | null
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
	cms_role: string | null
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const tab = url.searchParams.get('tab') ?? '전체'

	const { session } = await locals.safeGetSession()
	let isLoggedIn = !!session
	let isAdmin = false
	let viewerRole: string | null = null
	let currentUser: { displayName: string; avatarUrl: string | null; membershipGrade: string | null; level: string } | null = null

	if (session) {
		const { data: profile } = await locals.supabase
			.from('user_profiles')
			.select('full_name, membership_grade, credit_score, cms_role, avatar_url')
			.eq('id', session.user.id)
			.maybeSingle()
		const p = profile as { full_name: string | null; membership_grade: string | null; credit_score: number | null; cms_role: string | null; avatar_url: string | null } | null
		isAdmin = !!p?.cms_role
		viewerRole = p?.cms_role ?? null
		const score = p?.credit_score ?? 0
		const level = score >= 85 ? 'LV.5' : score >= 70 ? 'LV.4' : score >= 50 ? 'LV.3' : score >= 30 ? 'LV.2' : 'LV.1'
		currentUser = {
			displayName:     p?.full_name ?? '익명',
			avatarUrl:       p?.avatar_url ?? null, // 개인정보 화면 프로필 사진과 연동
			membershipGrade: resolveGrade(p?.membership_grade),
			level,
		}
	}

	// user_posts.user_id → auth.users.id 참조.
	// user_profiles.id도 auth.users.id와 동일(PK = auth UID)이지만
	// user_posts → user_profiles 간 직접 FK가 없어 PostgREST !inner join 불가.
	// → 포스트 조회 후 user_profiles 별도 쿼리로 작성자명 조회.
	// 로그인 작성자는 본인의 보류(is_public=false) 포스트도 목록에 노출
	const userId = session?.user.id
	let query = locals.supabase
		.from('user_posts')
		.select('id, title, log_type, content_blocks, created_at, user_id, thumbnail_url, is_public')
		.eq('status', 'published')
		.order('created_at', { ascending: false })
		.limit(50)

	// 공개 글은 누구나, 비공개(is_public=false) 글은 작성자 본인과 관리자만(2026-10-05 — 관리자는 비공개 글도 흐리게 표시된 채 목록에 남는다)
	if (!isAdmin) {
		query = query.or(userId ? `is_public.eq.true,user_id.eq.${userId}` : 'is_public.eq.true')
	}

	if (tab === '상품리뷰' || tab === '일상공유' || tab === '채널홍보') {
		query = query.eq('log_type', tab)
	}

	const { data: rawPostsAny, error } = await query
	if (error) console.error('[crazylog/list] posts query error:', error)
	const rawPosts = (rawPostsAny ?? []) as PostRow[]

	// 작성자 이름 별도 조회 (user_profiles.id == user_posts.user_id)
	const userIds = [...new Set(rawPosts.map(p => p.user_id).filter(Boolean))]
	const authorMap: Record<string, string> = {}
	const authorIsAdminMap: Record<string, boolean> = {}

	if (userIds.length > 0) {
		const { data: profilesAny } = await locals.supabase
			.from('user_profiles')
			.select('id, full_name, cms_role')
			.in('id', userIds)
		for (const profile of (profilesAny ?? []) as ProfileRow[]) {
			if (profile.id) {
				authorMap[profile.id] = profile.full_name ?? '익명'
				authorIsAdminMap[profile.id] = !!profile.cms_role
			}
		}
	}

	const postList = rawPosts.map(p => ({
		id:           p.id,
		title:        p.title,
		logType:      p.log_type ?? '',
		createdAt:    p.created_at,
		author:       authorMap[p.user_id] ?? '익명',
		thumbnailUrl: p.thumbnail_url ?? extractFirstImageUrl(p.content_blocks) ?? null,
		isPublic:     p.is_public !== false,
		// 작성자 user_id는 클라이언트로 내리지 않는다 — 본인 글 여부만 전달
		isMine:       !!userId && p.user_id === userId,
		// 삭제 아이콘 노출 여부(2026-10-05) — 관리자 글은 모든 관리자, 사용자 글은 매니저 이상(DB can_delete_user_post와 동일 규칙). 작성자 역할값·user_id는 내리지 않는다
		canDelete:    isAdmin && canDeletePost({
			isOwner:       !!userId && p.user_id === userId,
			viewerRole,
			authorIsAdmin: authorIsAdminMap[p.user_id] ?? false,
		}),
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
		isAdmin,
		// 검색 결과(작성자 정보 없음)의 삭제 아이콘 노출 기준 — 매니저 이상만 모든 글 삭제 가능
		isManager: !!viewerRole && hasSettingsAccess(viewerRole),
		currentUser,
	}
}
