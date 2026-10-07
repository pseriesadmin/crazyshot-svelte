import { redirect, error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { resolveGrade } from '$lib/utils/membership'

function calcLevel(creditScore: number | null): string {
	const score = creditScore ?? 0
	if (score >= 85) return 'LV.5'
	if (score >= 70) return 'LV.4'
	if (score >= 50) return 'LV.3'
	if (score >= 30) return 'LV.2'
	return 'LV.1'
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const { session } = await locals.safeGetSession()
	if (!session) {
		throw redirect(303, `/auth/login?redirect=${encodeURIComponent(url.pathname)}`)
	}

	const userId = session.user.id

	// 사용자 프로필 조회
	const { data: profileRaw } = await locals.supabase
		.from('user_profiles')
		.select('full_name, membership_grade, credit_score, cms_role, avatar_url')
		.eq('id', userId)
		.maybeSingle()

	const profile = profileRaw as {
		full_name: string | null
		membership_grade: string | null
		credit_score: number | null
		cms_role: string | null
		avatar_url: string | null
	} | null

	// 콘텐츠 통계 조회 (Migration #117 신규 RPC — 타입 미등록, as any 캐스트)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { data: statsRows } = await (locals.supabase.rpc as any)(
		'get_user_post_stats',
		{ p_user_id: userId }
	) as { data: Array<{ post_count: number; total_view_count: number }> | null }

	const stats = statsRows?.[0] ?? { post_count: 0, total_view_count: 0 }

	const displayName = profile?.full_name ?? '익명'
	const membershipGrade = resolveGrade(profile?.membership_grade)
	const level = calcLevel(profile?.credit_score ?? null)
	const isAdmin = !!profile?.cms_role

	// 수정 모드: slug가 UUID이면 기존 포스트 로드
	let existingPost: Record<string, unknown> | null = null
	if (params.slug !== 'new') {
		const { data: post, error: postError } = await locals.supabase
			.from('user_posts')
			.select('*')
			.eq('id', params.slug)
			.single()

		if (postError || !post) {
			throw error(404, '포스트를 찾을 수 없습니다.')
		}

		const postData = post as { user_id: string; [key: string]: unknown }

		// 본인 글 또는 관리자만 수정 가능
		if (postData.user_id !== userId && !isAdmin) {
			throw error(403, '수정 권한이 없습니다.')
		}

		// 본문은 정화하지 않은 원본을 에디터로 내려보낸다(2026-10-06). 정화본을 내려보내면 수정 후 저장 시 이미지·iframe·색상 등 원본이
		// 영구히 정화본으로 덮어써진다. 안전성: 새 에디터는 변환 가능한 블록을 스키마(허용 노드·마크)로만 불러오고, 변환 불가 원본은
		// 샌드박스 iframe(스크립트·이벤트·외부 접근 차단)으로만 미리 보여준다. 저장값은 원래 원본이고, 다른 방문자에게 보이는 상세 화면은
		// 서버 로더(view/[slug])가 계속 정화한다.
		existingPost = { ...postData }
	}

	const postViewCount = existingPost
		? Number((existingPost as { view_count?: unknown }).view_count ?? 0)
		: null

	return {
		session,
		profile: {
			displayName,
			membershipGrade,
			level,
			// 개인정보 화면에서 올린 프로필 사진(user_profiles.avatar_url)과 연동 — 없으면 화면이 이니셜로 표시
			avatarUrl: profile?.avatar_url ?? null,
		},
		stats: {
			postCount: Number(stats.post_count ?? 0),
			totalViewCount: Number(stats.total_view_count ?? 0),
			postViewCount,
		},
		existingPost,
		isAdmin,
	}
}
