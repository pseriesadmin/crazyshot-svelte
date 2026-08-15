/**
 * GET /api/chat/reservation-status/[id]
 * 상담채팅 액션카드(예: 반납 등록하기)가 클릭 가능 여부를 판단하기 위해
 * 예약의 현재 status만 반환하는 경량 엔드포인트.
 *
 * 접근 허용: CMS 관리자(getCmsRoleForAction) 또는 그 예약의 소유 고객(session.user.id) 둘 중 하나.
 * — 관리자가 CMS 상담채팅(/cms/chat)에서 자신이 보낸 카드를 미리보기 클릭할 때도 필요하고,
 *   고객이 채팅에서 같은 카드를 클릭할 때도 필요해 두 경로 모두 허용한다.
 *
 * 조회는 service_role(RLS 우회)로 수행하고, 접근 가능 여부는 애플리케이션 코드에서 명시적으로
 * 검증한다 — rental_reservations RLS는 소유 고객만 SELECT를 허용해 locals.supabase로는 관리자가
 * 다른 고객의 예약을 조회할 수 없으므로(cms/reservation 등 기존 CMS 조회부와 동일 패턴).
 */
import { json, error } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '로그인이 필요합니다.')

  const reservationId = parseInt(params.id, 10)
  if (isNaN(reservationId) || reservationId <= 0) throw error(400, '유효하지 않은 예약 ID입니다.')

  const cmsRole = await getCmsRoleForAction(locals)

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: reservation, error: resErr } = await admin
    .from('rental_reservations')
    .select('status, user_id')
    .eq('id', reservationId)
    .maybeSingle()

  if (resErr || !reservation) throw error(404, '예약을 찾을 수 없습니다.')

  const r = reservation as { status: string; user_id: string }
  const isOwner = r.user_id === session.user.id
  if (!cmsRole && !isOwner) throw error(403, '접근 권한이 없습니다.')

  return json({ status: r.status })
}
