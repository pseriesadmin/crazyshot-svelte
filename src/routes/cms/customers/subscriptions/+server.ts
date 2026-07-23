import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { fetchCmsProfileByAuthId } from '$lib/server/cmsProfile'
import type { RequestHandler } from './$types'

// GET /cms/customers/subscriptions?userId=<user_profiles.id>
// CMS 관리자 전용: 구독 이력 조회 (service_role 사용, user_subscriptions RLS 우회)
export const GET: RequestHandler = async ({ locals, url }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '인증 필요' }, { status: 403 })

  const profile = await fetchCmsProfileByAuthId(locals.supabase, session.user.id)
  if (!profile?.cms_role) return json({ error: 'CMS 권한 없음' }, { status: 403 })

  const userId = url.searchParams.get('userId')
  if (!userId) return json({ error: 'userId 필수' }, { status: 400 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const { data, error } = await admin
    .from('user_subscriptions')
    .select('id, plan_id, status, started_at, expires_at, cancelled_at, created_at, subscription_plans(name)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) return json({ error: error.message }, { status: 500 })

  return json(data ?? [])
}
