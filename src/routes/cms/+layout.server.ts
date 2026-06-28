import { redirect } from '@sveltejs/kit'
import { fetchCmsProfileByAuthId } from '$lib/server/cmsProfile'
import type { LayoutServerLoad } from './$types'

const PUBLIC_CMS_PATHS = ['/cms/login']

export const load: LayoutServerLoad = async ({ locals, url }) => {
  if (PUBLIC_CMS_PATHS.some((p) => url.pathname.startsWith(p))) return {}

  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/cms/login')

  const profile = await fetchCmsProfileByAuthId(locals.supabase, session.user.id)
  if (!profile?.cms_role) throw redirect(303, '/cms/login')

  if (url.pathname.startsWith('/cms/accounts') && profile.cms_role !== 'superadmin') {
    throw redirect(303, '/cms')
  }

  return { session, cmsRole: profile.cms_role as string }
}
