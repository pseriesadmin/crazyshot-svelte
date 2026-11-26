import type { Cookies } from '@sveltejs/kit'
import type { SupabaseClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'

// 크레이지로그 상세 — 조회수 집계 + '같은 분류에서 많이 본 로그' 목록 (2026-11-26, Migration #851)

/** 같은 사람(브라우저)의 새로고침·재방문이 조회수를 반복해서 올리지 않게 최근 본 글 id 를 쿠키에 기억한다 */
const VIEW_COOKIE = 'cs_clv'
const VIEW_COOKIE_MAX = 30
const VIEW_COOKIE_AGE_SEC = 60 * 60 * 24

export const TOP_VIEWED_LIMIT = 10

function readSeen(cookies: Cookies): string[] {
	const raw = cookies.get(VIEW_COOKIE)
	if (!raw) return []
	return raw.split(',').filter((v) => /^[0-9a-f-]{36}$/i.test(v)).slice(0, VIEW_COOKIE_MAX)
}

/**
 * 게시·공개된 글의 조회수를 1 올린다(브라우저당 24시간에 한 번). 화면이 열린 뒤 호출되는 form action 에서만 쓴다(load 에서 호출 금지 — hover 프리로드로 오른다).
 * 서버 전용 함수 increment_crazylog_post_view(service_role만 실행 가능)를 호출하며, 실패해도 화면은 막지 않는다(fail-soft).
 */
export async function countPostView(cookies: Cookies, postId: string, secure = true): Promise<void> {
	const seen = readSeen(cookies)
	if (seen.includes(postId)) return
	try {
		const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
		if (!serviceKey) return
		const admin = createClient(getSupabaseUrl(), serviceKey)
		const { error } = await admin.rpc('increment_crazylog_post_view', { p_post_id: postId })
		if (error) {
			console.error('[crazylog] 조회수 집계 실패:', error.message)
			return
		}
		cookies.set(VIEW_COOKIE, [postId, ...seen].slice(0, VIEW_COOKIE_MAX).join(','), {
			path: '/',
			maxAge: VIEW_COOKIE_AGE_SEC,
			httpOnly: true,
			sameSite: 'lax',
			secure, // https 에서만 secure — 로컬 http(Safari 등)에서도 쿠키가 저장돼 새로고침마다 +1 되지 않게
		})
	} catch (e) {
		console.error('[crazylog] 조회수 집계 예외:', e instanceof Error ? e.message : e)
	}
}

export interface TopViewedPost {
	id: string
	title: string
	logType: string
	createdAt: string
	thumbnailUrl: string | null
	viewCount: number
}

type Row = {
	id: string
	title: string
	log_type: string | null
	content_blocks: unknown
	thumbnail_url: string | null
	created_at: string
	view_count: number | null
}

function firstImageUrl(blocks: unknown): string | null {
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

/**
 * 같은 분류(log_type)의 게시·공개 글을 조회수 많은 순으로 최대 10개 반환한다(현재 보고 있는 글은 제외).
 * 조회수가 같거나 아직 0이면 최신 글이 먼저 오도록 created_at 내림차순을 보조 정렬로 쓴다.
 */
export async function loadTopViewedPosts(
	supabase: SupabaseClient,
	logType: string,
	excludeId: string
): Promise<TopViewedPost[]> {
	if (!logType) return []
	const { data, error } = await supabase
		.from('user_posts')
		.select('id, title, log_type, content_blocks, thumbnail_url, created_at, view_count')
		.eq('status', 'published')
		.eq('is_public', true)
		.eq('log_type', logType)
		.neq('id', excludeId)
		.order('view_count', { ascending: false })
		.order('created_at', { ascending: false })
		.limit(TOP_VIEWED_LIMIT)
	if (error) {
		console.error('[crazylog] 많이 본 로그 조회 실패:', error.message)
		return []
	}
	return ((data ?? []) as Row[]).map((r) => ({
		id: r.id,
		title: r.title,
		logType: r.log_type ?? '',
		createdAt: r.created_at,
		thumbnailUrl: r.thumbnail_url || firstImageUrl(r.content_blocks),
		viewCount: r.view_count ?? 0,
	}))
}
