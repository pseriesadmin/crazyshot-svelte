import { redirect } from '@sveltejs/kit'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import type { PageServerLoad } from './$types'

export interface TopPost {
	id: string
	title: string
	log_type: string | null
	view_count: number
}

export interface ContentStats {
	total_posts: number
	published_posts: number
	total_views: number
	posts_by_log_type: Record<string, number>
	top_posts: TopPost[]
}

const EMPTY_STATS: ContentStats = {
	total_posts: 0,
	published_posts: 0,
	total_views: 0,
	posts_by_log_type: {},
	top_posts: [],
}

export const load: PageServerLoad = async ({ parent, locals }) => {
	const { cmsRole } = await parent()
	if (!hasSettingsAccess(cmsRole ?? '')) {
		throw redirect(303, '/cms?notice=access_denied')
	}

	const { data, error } = await locals.supabase.rpc('get_crazylog_content_stats')
	if (error) console.error('[cms/promotion/content] stats query error:', error)

	const row = (Array.isArray(data) ? data[0] : data) as Partial<ContentStats> | null
	const stats: ContentStats = row
		? {
				total_posts: Number(row.total_posts ?? 0),
				published_posts: Number(row.published_posts ?? 0),
				total_views: Number(row.total_views ?? 0),
				posts_by_log_type: (row.posts_by_log_type as Record<string, number>) ?? {},
				top_posts: (row.top_posts as TopPost[]) ?? [],
			}
		: EMPTY_STATS

	return { stats }
}
