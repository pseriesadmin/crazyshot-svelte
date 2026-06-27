import { redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createClient } from '@supabase/supabase-js'
import type { LayoutServerLoad } from './$types'

const PUBLIC_CMS_PATHS = ['/cms/login']

export const load: LayoutServerLoad = async ({ locals, url }) => {
  if (PUBLIC_CMS_PATHS.some((p) => url.pathname.startsWith(p))) return {}

  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/cms/login')

  // service role로 cms_role 확인 (user_profiles RLS 정책 없음)
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) throw redirect(303, '/cms/login')

  const admin = createClient(PUBLIC_SUPABASE_URL, serviceRoleKey)
  const { data } = await admin
    .from('user_profiles')
    .select('cms_role')
    .eq('id', session.user.id)
    .single()

  const profile = data as { cms_role: string | null } | null
  if (!profile?.cms_role) throw redirect(303, '/cms/login')

  if (url.pathname.startsWith('/cms/accounts') && profile.cms_role !== 'superadmin') {
    throw redirect(303, '/cms')
  }

  return { session, cmsRole: profile.cms_role as string }
}
