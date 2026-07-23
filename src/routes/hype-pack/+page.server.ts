import type { PageServerLoad } from './$types'

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

	return { isCms }
}
