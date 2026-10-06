// GET /api/cms/coupons/available — 관리자 직접발송용 발급 가능 쿠폰 목록
// 활성 + 미삭제 쿠폰 반환 — 무제한·발급후N일 쿠폰만 선물 가능(날짜 지정 fixed_period 쿠폰은 선물 차단)
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createClient } from '@supabase/supabase-js'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'

export const GET: RequestHandler = async ({ locals, url }) => {
  const denied = await requireMenuAccessApi(locals, 'consulting.chat')
  if (denied) return denied
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류입니다.' }, { status: 500 })

  const admin = createClient(PUBLIC_SUPABASE_URL, serviceRoleKey)

  const { data, error } = await admin
    .from('coupons')
    .select('id, code, display_name, description, discount_type, discount_value, max_discount_amount, valid_from, valid_until, usage_limit, usage_count')
    .eq('is_active', true)
    .is('deleted_at', null)
    .neq('validity_type', 'fixed_period')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return json({ error: '쿠폰 목록 조회 실패' }, { status: 500 })

  const coupons = data ?? []

  // 대상 고객(user_id)이 지정됐으면 이미 보유(사용 포함)한 쿠폰을 already_owned로 표시 —
  // 관리자가 재선물을 시도하기 전에 화면에서 먼저 안내하기 위함(서버측 최종 차단은
  // couponGiftDuplicate.ts가 direct-send/approve 양쪽에서 이미 담당).
  const targetUserId = url.searchParams.get('user_id')
  if (!targetUserId || coupons.length === 0) {
    return json(coupons.map((c) => ({ ...c, already_owned: false })))
  }

  const couponIds = coupons.map((c) => (c as { id: string }).id)
  const { data: ownedRaw } = await admin
    .from('user_coupons')
    .select('coupon_id')
    .eq('user_id', targetUserId)
    .in('coupon_id', couponIds)

  const ownedIds = new Set((ownedRaw as { coupon_id: string }[] ?? []).map((r) => r.coupon_id))

  return json(coupons.map((c) => ({ ...c, already_owned: ownedIds.has((c as { id: string }).id) })))
}
