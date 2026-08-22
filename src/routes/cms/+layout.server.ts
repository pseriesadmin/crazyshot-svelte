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
    // /cms/mobile 경로 진입 시 로그인 후 돌아올 수 있도록 returnTo 전달
    const returnTo = url.pathname.startsWith('/cms/mobile') ? url.pathname : null
    if (hadSession) {
      const t = encodeURIComponent(new Date().toISOString())
      const params = new URLSearchParams({ logout: 'expired', t })
      if (returnTo) params.set('returnTo', returnTo)
      throw redirect(303, `/cms/login?${params}`)
    }
    const loginUrl = returnTo
      ? `/cms/login?returnTo=${encodeURIComponent(returnTo)}`
      : '/cms/login'
    throw redirect(303, loginUrl)
  }

  // 로그인 상태 유지 미체크 시: 브라우저 종료 후 재진입하면 cms-remember 세션쿠키가 없음 → 로그아웃
  const rememberOk = cookies.get('cms-remember')
  if (!rememberOk) {
    await locals.supabase.auth.signOut()
    const t = encodeURIComponent(new Date().toISOString())
    throw redirect(303, `/cms/login?logout=expired&t=${t}`)
  }

  const profile = await fetchCmsProfileByAuthId(locals.supabase, session.user.id)
  if (!profile?.cms_role) throw redirect(303, '/cms/login')

  const role = profile.cms_role as string

  if (!hasRouteAccess(role, url.pathname)) {
    throw redirect(303, '/cms?notice=access_denied')
  }

  locals.cmsRole = role
  return { session, cmsRole: role }
}
