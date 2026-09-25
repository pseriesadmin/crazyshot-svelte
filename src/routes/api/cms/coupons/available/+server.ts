// GET /api/cms/coupons/available — 관리자 직접발송용 발급 가능 쿠폰 목록
// 활성 + 미삭제 쿠폰 반환 — 무제한·발급후N일 쿠폰만 선물 가능(날짜 지정 fixed_period 쿠폰은 선물 차단)
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createClient } from '@supabase/supabase-js'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

export const GET: RequestHandler = async ({ locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류입니다.' }, { status: 500 })

  const admin = createClient(PUBLIC_SUPABASE_URL, serviceRoleKey)

  const { data, error } = await admin
    .from('coupons')
    .select('id, code, description, discount_type, discount_value, max_discount_amount, valid_from, valid_until, usage_limit, usage_count')
    .eq('is_active', true)
    .is('deleted_at', null)
    .neq('validity_type', 'fixed_period')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return json({ error: '쿠폰 목록 조회 실패' }, { status: 500 })

  return json(data ?? [])
}
