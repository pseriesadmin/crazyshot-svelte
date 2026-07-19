import type { PageServerLoad } from './$types'

type PostRow = {
	id: string
	title: string
	log_type: string | null
	content_blocks: unknown
	created_at: string
	user_id: string
	thumbnail_url: string | null
	status: string
}
type ProfileRow = {
	id: string
	full_name: string | null
}
type CommentRow = {
	id: string
	post_id: string
	author_name: string | null
	content: string
	created_at: string
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

function extractYoutubeVideoId(blocks: unknown): string | null {
	if (!Array.isArray(blocks)) return null
	for (const block of blocks) {
		const b = block as Record<string, unknown>
		if (b.type === 'youtube' && typeof b.videoId === 'string' && b.videoId.trim()) {
			return b.videoId.trim()
		}
	}
	return null
}

export const load: PageServerLoad = async ({ locals, params }) => {
	const { session } = await locals.safeGetSession()

	let isAdmin = false
	let isLoggedIn = !!session
	let currentUser: { displayName: string; avatarUrl: string | null; membershipGrade: string | null; level: string } | null = null

	if (session) {
		const { data: profile } = await locals.supabase
			.from('user_profiles')
			.select('cms_role, full_name, avatar_url, membership_grade, credit_score')
			.eq('id', session.user.id)
			.maybeSingle()
		const profileData = profile as {
			cms_role: string | null
			full_name: string | null
			avatar_url: string | null
			membership_grade: string | null
			credit_score: number | null
		} | null
		isAdmin = !!profileData?.cms_role

		const score = profileData?.credit_score ?? 0
		const level = score >= 85 ? 'LV.5' : score >= 70 ? 'LV.4' : score >= 50 ? 'LV.3' : score >= 30 ? 'LV.2' : 'LV.1'
		currentUser = {
			displayName: profileData?.full_name ?? '익명',
			avatarUrl:   profileData?.avatar_url ?? null,
			membershipGrade: profileData?.membership_grade ?? null,
			level,
		}
	}

	const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
	if (!uuidPattern.test(params.slug)) {
		return { isAdmin, isLoggedIn, currentUser, postId: params.slug, postStatus: null, post: null, comments: [] }
	}

	const { data: rawPost } = await locals.supabase
		.from('user_posts')
		.select('id, title, log_type, content_blocks, created_at, user_id, thumbnail_url, status')
		.eq('id', params.slug)
		.maybeSingle()

	const postData = rawPost as PostRow | null
	if (!postData) {
		return { isAdmin, isLoggedIn, currentUser, postId: params.slug, postStatus: null, post: null, comments: [] }
	}

	// 작성자 이름 + 댓글 목록 병렬 조회
	const [profileResult, commentsResult] = await Promise.all([
		locals.supabase
			.from('user_profiles')
			.select('id, full_name')
			.eq('id', postData.user_id)
			.maybeSingle(),
		locals.supabase
			.from('post_comments')
			.select('id, post_id, author_name, content, created_at')
			.eq('post_id', params.slug)
			.eq('is_public', true)
			.order('created_at', { ascending: true }),
	])

	const profileData = profileResult.data as ProfileRow | null
	const authorName = profileData?.full_name ?? '익명'

	const comments = ((commentsResult.data ?? []) as CommentRow[]).map(c => ({
		id:         c.id,
		authorName: c.author_name ?? '익명',
		content:    c.content,
		createdAt:  c.created_at,
	}))

	// YouTube videoId 파생
	const youtubeVideoId = extractYoutubeVideoId(postData.content_blocks)

	// thumbnail_url이 없으면: content_blocks 첫 이미지 → 유튜브 기본 썸네일 순으로 파생
	const derivedThumbnail =
		postData.thumbnail_url ??
		extractFirstImageUrl(postData.content_blocks) ??
		(youtubeVideoId ? `https://img.youtube.com/vi/${youtubeVideoId}/maxresdefault.jpg` : null) ??
		null

	const post = {
		id:            postData.id,
		title:         postData.title,
		logType:       postData.log_type ?? '',
		contentBlocks: postData.content_blocks as unknown[],
		createdAt:     postData.created_at,
		author:        authorName,
		thumbnailUrl:  derivedThumbnail,
		youtubeVideoId,
		status:        postData.status,
		userId:        postData.user_id,
	}

	const currentUserId = session?.user.id ?? null
	const isOwner = !!currentUserId && currentUserId === postData.user_id

	return { isAdmin, isLoggedIn, isOwner, currentUser, postId: params.slug, postStatus: postData.status, post, comments }
}
