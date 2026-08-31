/**
 * GET  /api/cms/reservations/[id]/tracking — 현재 운송장 정보 조회 (CMS 전용)
 * PATCH /api/cms/reservations/[id]/tracking — 운송장 정보 저장 (CMS 전용)
 *
 * GET  : service_role로 조회 (RLS 우회 — 관리자는 모든 예약 조회 가능해야 함)
 * PATCH: locals.supabase(관리자 실세션)으로 update_reservation_tracking RPC 호출
 *        — RPC 내부의 is_cms_user() 검증이 auth.uid() 기반이라 service_role 호출 시 거부됨
 */
import { json, error } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { sendReservationLifecyclePush } from '$lib/server/push'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ params, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한이 없습니다.' }, { status: 403 })

  const reservationId = parseInt(params.id, 10)
  if (isNaN(reservationId) || reservationId <= 0) {
    return json({ error: '유효하지 않은 예약 ID입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data, error: resErr } = await admin
    .from('rental_reservations')
    .select('tracking_number, courier_code')
    .eq('id', reservationId)
    .maybeSingle()

  if (resErr || !data) return json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 })

  const r = data as { tracking_number: string | null; courier_code: string | null }
  return json({ tracking_number: r.tracking_number ?? null, courier_code: r.courier_code ?? null })
}

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '로그인이 필요합니다.')

  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) throw error(403, '권한이 없습니다.')

  const reservationId = parseInt(params.id, 10)
  if (isNaN(reservationId) || reservationId <= 0) throw error(400, '유효하지 않은 예약 ID입니다.')

  const body = await request.json() as { tracking_number?: string; courier_code?: string }
  const trackingNumber = (body.tracking_number ?? '').trim() || null
  const courierCode    = (body.courier_code    ?? '').trim() || null

  // RSV-B-B5: 운송장 번호 형식 검증 (숫자·영문·하이픈 조합, 최대 50자)
  if (trackingNumber !== null) {
    if (trackingNumber.length > 50 || !/^[A-Za-z0-9\-]+$/.test(trackingNumber)) {
      throw error(400, '운송장 번호 형식이 올바르지 않습니다. 영문·숫자·하이픈만 허용하며 최대 50자입니다.')
    }
  }

  // locals.supabase 사용 필수 — update_reservation_tracking RPC 내부의 is_cms_user()가
  // auth.uid() 기반이라 관리자의 실세션으로 호출해야 통과됨
  // (service_role 호출 시 auth.uid()=null → is_cms_user() false → EXCEPTION 발생)
  // Supabase 생성 타입에 신규 RPC가 없으므로 unknown 경유 캐스트(any 대신 명시적 함수 시그니처)
  const { error: rpcErr } = await (locals.supabase.rpc as unknown as (
    fn: string, args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>)('update_reservation_tracking', {
    p_reservation_id:  reservationId,
    p_tracking_number: trackingNumber,
    p_courier_code:    courierCode,
  })

  if (rpcErr) throw error(500, '운송장 정보 저장 중 오류가 발생했습니다.')

  // RSV-B-B4: 운송장 등록 완료 안내 — 채팅카드 + 브라우저 푸시(fail-soft, 저장 자체는 이미 성공)
  // service-operations.md §15: 채팅카드(RPC)와 브라우저 푸시는 별개 시스템이라 둘 다 명시 호출 필요.
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  try {
    await admin.rpc('send_rental_chat_notification', {
      p_reservation_id: reservationId,
      p_notify_type:    'tracking_notify',
    })
  } catch (e) {
    console.error(`[tracking/chat-notify] fail-soft [${reservationId}]:`, e instanceof Error ? e.message : e)
  }
  try {
    await sendReservationLifecyclePush(admin, reservationId, 'tracking_notify')
  } catch (e) {
    console.error(`[tracking/push-notify] fail-soft [${reservationId}]:`, e instanceof Error ? e.message : e)
  }

  return json({ success: true, tracking_number: trackingNumber, courier_code: courierCode })
}
