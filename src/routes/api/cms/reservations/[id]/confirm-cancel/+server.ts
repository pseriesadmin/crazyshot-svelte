// POST /api/cms/reservations/[id]/confirm-cancel
// 고객이 취소한 예약("취소중")에 대한 관리자 취소확인 — CMS 패널 헤더의 [예약취소] 버튼이 호출한다.
// 확인되면 마이페이지에서 "취소" 배지와 함께 대여 목록 → 취소 목록으로 이동한다(고객 카드 재정렬).
// 예약 상태·결제는 바꾸지 않는다(이미 고객 취소 시점에 취소·환불 처리됨) — 확인 표식만 남긴다.
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasMenuAccess, type CmsMenuPermissionOverride } from '$lib/constants/cmsMenus'

export const POST: RequestHandler = async ({ params, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '인증 필요' }, { status: 401 })
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ ok: false, error: '권한 없음' }, { status: 403 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return json({ ok: false, error: '잘못된 예약 ID입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 예약변경·취소 권한(rental.change_cancel) — 패널의 [예약취소] 버튼과 동일 기준
  const { data: permData } = await admin
    .from('cms_menu_permissions')
    .select('menu_key, allowed')
    .eq('user_id', session.user.id)
  if (!hasMenuAccess(cmsRole, (permData ?? []) as CmsMenuPermissionOverride[], 'rental.change_cancel')) {
    return json({ ok: false, error: '예약변경 및 취소 권한이 없습니다.' }, { status: 403 })
  }

  const { data, error } = await admin.rpc('confirm_customer_cancel', {
    p_reservation_id: reservationId,
    p_admin_id: session.user.id,
  })
  if (error) return json({ ok: false, error: '취소확인 처리 중 오류가 발생했습니다.' }, { status: 500 })

  const result = data as { ok?: boolean; error?: string; already?: boolean; confirmed_count?: number } | null
  if (!result?.ok) {
    const msg = result?.error === 'not_customer_cancelled'
      ? '고객이 취소한 예약이 아니어서 취소확인 대상이 아닙니다.'
      : '예약을 찾을 수 없습니다.'
    return json({ ok: false, error: msg }, { status: 400 })
  }
  return json({ ok: true, already: result.already === true, confirmedCount: result.confirmed_count ?? 0 })
}
