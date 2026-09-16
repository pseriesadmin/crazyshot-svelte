import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { fetchCmsProfileByAuthId } from '$lib/server/cmsProfile'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import type { RequestHandler } from './$types'

// GET /cms/customers/points?userId=<user_profiles.id>
// CMS 관리자 전용(manager 이상): 고객 포인트 이력 조회 (service_role, RLS 우회)
export const GET: RequestHandler = async ({ locals, url }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '인증 필요' }, { status: 403 })

  const profile = await fetchCmsProfileByAuthId(locals.supabase, session.user.id)
  if (!hasSettingsAccess(profile?.cms_role ?? '')) return json({ error: '권한 없음' }, { status: 403 })

  const userId = url.searchParams.get('userId')
  if (!userId) return json({ error: 'userId 필수' }, { status: 400 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  // userId = user_profiles.id (PK). point_transactions.user_id → auth.users.id 이므로 변환 필요
  // (rentals/+server.ts와 동일 패턴 — user_subscriptions와 달리 point_transactions는
  //  auth.users.id를 직접 참조하기 때문에 이 변환이 필요함)
  const { data: profileRow, error: profErr } = await admin
    .from('user_profiles')
    .select('user_id')
    .eq('id', userId)
    .single()

  if (profErr || !profileRow) return json({ error: 'profile_not_found' }, { status: 404 })

  const authUserId = profileRow.user_id as string

  const { data, error } = await admin
    .from('point_transactions')
    .select('id, type, amount, balance_after, description, ref_type, ref_id, created_at')
    .eq('user_id', authUserId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) return json({ error: error.message }, { status: 500 })

  return json(data ?? [])
}
