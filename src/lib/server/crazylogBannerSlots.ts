import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '$lib/types/database'
import { pickBannerItems, deriveBadgeLabel, type BannerPost, type BannerSlotConfig } from '$lib/utils/crazylogBanner'

// /crazylog 헤더 카드 3장과 홈 "요즘 크레이지·로그" 카드가 같은 데이터를 쓰도록 하는 단일 로더.
// 두 화면이 각자 슬롯 선택 로직을 복제하면 설정·표기(분류 라벨)가 어긋나므로 반드시 이 함수를 공유한다.

type BannerSettingsRow = Record<string, BannerSlotConfig | undefined>

type BannerPostRow = {
	id: string
	title: string
	log_type: string | null
	thumbnail_url: string | null
	view_count: number
	status: string
	is_public: boolean
	first_text: string | null
}

const BANNER_SLOTS = [
	{ key: 'crazylog_banner_slot1', fallbackLabel: 'Flash Deals' },
	{ key: 'crazylog_banner_slot2', fallbackLabel: '채널홍보' },
	{ key: 'crazylog_banner_slot3', fallbackLabel: 'Release' },
] as const

const MAX_BANNER_ITEMS = 3

interface BannerSlotResult {
	slotKey: string
	badgeLabel: string
	items: BannerPost[]
	settings: BannerSlotConfig
}

function shuffleArray<T>(arr: T[]): T[] {
	const a = [...arr]
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1))
		;[a[i], a[j]] = [a[j], a[i]]
	}
	return a
}

export async function loadBannerSlots(
	supabase: SupabaseClient<Database>,
	logTag = 'crazylog'
): Promise<BannerSlotResult[]> {
	// database.ts는 마이그레이션 210 신규 RPC를 아직 반영하지 않음 — 호출부(호출자가 아니라 이 로더 안)에서만 국소 캐스트
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const rpc = supabase.rpc.bind(supabase) as any
	const { data: settingsData, error: settingsError } = await rpc('get_crazylog_banner_settings')
	if (settingsError) console.error(`[${logTag}] get_crazylog_banner_settings 실패 — 배너 비움:`, settingsError.message)
	const settings = (settingsData ?? {}) as BannerSettingsRow

	const allIds = new Set<string>()
	for (const slot of BANNER_SLOTS) {
		const cfg = settings[slot.key]
		if (cfg) for (const p of cfg.posts) allIds.add(p.id)
	}

	const postMap = new Map<string, BannerPost>()
	if (allIds.size > 0) {
		const { data: postsData, error: postsError } = await rpc('get_crazylog_posts_by_ids', {
			p_ids: [...allIds],
		})
		if (postsError) console.error(`[${logTag}] get_crazylog_posts_by_ids 실패 — 배너 비움:`, postsError.message)
		for (const row of (postsData ?? []) as BannerPostRow[]) {
			postMap.set(row.id, {
				id: row.id,
				title: row.title,
				logType: row.log_type,
				img: row.thumbnail_url,
				desc: row.first_text || null,   // 본문 첫 텍스트 요약(#583) — 헤더 부제에 실제 내용 표시
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
