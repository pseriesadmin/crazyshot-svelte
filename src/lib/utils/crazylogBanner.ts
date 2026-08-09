export interface BannerPost {
	id: string
	title: string
	logType: string | null
	img: string | null
	desc: string | null
}

export interface BannerSlotConfig {
	posts: { id: string; order: number }[]
	mode: 'random' | 'fixed'
}

export function pickBannerItems(
	pool: BannerPost[],
	config: BannerSlotConfig,
	max: number,
	shuffle: <T>(arr: T[]) => T[]
): BannerPost[] {
	if (config.mode === 'fixed') {
		const order = new Map(config.posts.map((p) => [p.id, p.order]))
		return [...pool]
			.filter((p) => order.has(p.id))
			.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
			.slice(0, max)
	}
	return shuffle(pool).slice(0, max)
}

export function deriveBadgeLabel(items: BannerPost[], fallback: string): string {
	if (items.length === 0) return fallback
	const counts = new Map<string, number>()
	for (const item of items) {
		const type = item.logType ?? fallback
		counts.set(type, (counts.get(type) ?? 0) + 1)
	}
	let best = items[0].logType ?? fallback
	let bestCount = 0
	for (const item of items) {
		const type = item.logType ?? fallback
		const count = counts.get(type) ?? 0
		if (count > bestCount) {
			bestCount = count
			best = type
		}
	}
	return best
}
