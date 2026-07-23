import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { fetchCmsProfileByAuthId } from '$lib/server/cmsProfile'
import type { RequestHandler } from './$types'

// GET /cms/customers/addresses?userId=<user_profiles.id>
// CMS 관리자 전용: 특정 회원의 배송지 목록을 service_role로 조회
// 브라우저 Supabase 클라이언트 대신 서버사이드에서 처리하여 auth.uid() NULL 문제 회피
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
    .from('user_shipping_addresses')
    .select('id, label, recipient, phone, road_address, detail_address, postal_code, is_default, sort_order, created_at')
    .eq('user_id', userId)
    .order('is_default', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return json({ error: error.message }, { status: 500 })

  return json(data ?? [])
}
