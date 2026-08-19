import type { SupabaseClient } from '@supabase/supabase-js'
import type { PageServerLoad } from './$types'
import type { Database } from '$lib/types/database'
import { pickBannerItems, deriveBadgeLabel, type BannerPost, type BannerSlotConfig } from '$lib/utils/crazylogBanner'

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

type BannerSettingsRow = Record<string, BannerSlotConfig | undefined>

type BannerPostRow = {
	id: string
	title: string
	log_type: string | null
	thumbnail_url: string | null
	view_count: number
	status: string
	is_public: boolean
}

const BANNER_SLOTS = [
	{ key: 'crazylog_banner_slot1', fallbackLabel: 'Flash Deals' },
	{ key: 'crazylog_banner_slot2', fallbackLabel: '채널홍보' },
	{ key: 'crazylog_banner_slot3', fallbackLabel: 'Release' },
] as const

const MAX_BANNER_ITEMS = 3

export interface BannerSlotResult {
	slotKey: string
	badgeLabel: string
	items: BannerPost[]
	settings: BannerSlotConfig
}

async function loadBannerSlots(
	supabase: SupabaseClient<Database>
): Promise<BannerSlotResult[]> {
	// database.ts는 마이그레이션 210 신규 RPC를 아직 반영하지 않음 — rpc 호출부만 국소 캐스트
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { data: settingsData } = await (supabase.rpc as any)('get_crazylog_banner_settings')
	const settings = (settingsData ?? {}) as BannerSettingsRow

	const allIds = new Set<string>()
	for (const slot of BANNER_SLOTS) {
		const cfg = settings[slot.key]
		if (cfg) for (const p of cfg.posts) allIds.add(p.id)
	}

	let postMap = new Map<string, BannerPost>()
	if (allIds.size > 0) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const { data: postsData } = await (supabase.rpc as any)('get_crazylog_posts_by_ids', {
			p_ids: [...allIds],
		})
		for (const row of (postsData ?? []) as BannerPostRow[]) {
			postMap.set(row.id, {
				id: row.id,
				title: row.title,
				logType: row.log_type,
				img: row.thumbnail_url,
				desc: null,
			})
		}
	}

	return BANNER_SLOTS.map((slot) => {
		const cfg = settings[slot.key] ?? { posts: [], mode: 'random' as const }
		const pool = cfg.posts.map((p) => postMap.get(p.id)).filter((p): p is BannerPost => !!p)
		const items = pickBannerItems(pool, cfg, MAX_BANNER_ITEMS, shuffleArray)
		return {
			slotKey: slot.key,
			badgeLabel: deriveBadgeLabel(items, slot.fallbackLabel),
			items,
			settings: cfg,
		}
	})
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

	const [reviewCount, shareCount, promoCount, { data: rawAny, error }, bannerSlots, kwSetting] = await Promise.all([
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
		loadBannerSlots(locals.supabase),
		locals.supabase
			.from('cms_settings')
			.select('value')
			.eq('key', 'crazylog_head_keywords')
			.maybeSingle(),
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
		desc:      extractFirstText(p.content_blocks) || null,
		bar:       BAR_COLORS[p.log_type ?? ''] ?? '#3b2f8a',
		rounded:   i % 2 === 0,
	}))

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const headKeywordsRaw = ((kwSetting as any).data?.value as { items?: Array<{ title: string; href: string }> } | null)
	const headKeywords    = headKeywordsRaw?.items ?? []

	// 크레이지로그 포스트 제목 목록 — 키워드 선택 피커 옵션으로 사용 (id+title+href)
	const headKeywordOptions = (rawPosts as PostRow[])
		.filter((p) => p.title)
		.map((p) => ({ id: p.id, title: p.title, href: `/crazylog/view/${p.id}` }))

	return {
		counts: {
			review: reviewCount.count ?? 0,
			share:  shareCount.count  ?? 0,
			promo:  promoCount.count  ?? 0,
		},
		posts,
		bannerSlots,
		isCms,
		headKeywords,
		headKeywordsRaw: headKeywordsRaw ?? { items: [] },
		headKeywordOptions,
	}
}
