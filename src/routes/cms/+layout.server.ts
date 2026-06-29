import { redirect } from '@sveltejs/kit'
import { fetchCmsProfileByAuthId } from '$lib/server/cmsProfile'
import { hasRouteAccess } from '$lib/utils/cmsPermissions'
import type { LayoutServerLoad } from './$types'

const PUBLIC_CMS_PATHS = ['/cms/login']

export const load: LayoutServerLoad = async ({ locals, url, cookies }) => {
  if (PUBLIC_CMS_PATHS.some((p) => url.pathname.startsWith(p))) return {}

  const { session } = await locals.safeGetSession()
  if (!session) {
    // auth 쿠키가 남아 있으면 세션 만료, 없으면 최초 방문
    const hadSession = cookies.getAll().some(
      (c) => c.name.startsWith('sb-') && c.name.includes('auth-token')
    )
    if (hadSession) {
      const t = encodeURIComponent(new Date().toISOString())
      throw redirect(303, `/cms/login?logout=expired&t=${t}`)
    }
    throw redirect(303, '/cms/login')
  }

  const profile = await fetchCmsProfileByAuthId(locals.supabase, session.user.id)
  if (!profile?.cms_role) throw redirect(303, '/cms/login')

  const role = profile.cms_role as string

  if (!hasRouteAccess(role, url.pathname)) {
    throw redirect(303, '/cms?notice=access_denied')
  }

  return { session, cmsRole: role }
}
