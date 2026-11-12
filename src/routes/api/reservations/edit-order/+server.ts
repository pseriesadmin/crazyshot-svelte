import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { sendPushToAdmins } from '$lib/server/push'
import { takeRate } from '$lib/server/guard/rateLimit'
import { EDIT_ORDER_GENERIC_FAILURE, interpretEditOrderResult, parseEditOrderBody } from '$lib/server/reservationEditOrder'
import type { RequestHandler } from './$types'

// 신청대기(hold) 예약 '예약 수정' 저장 — Migration 811 edit_submitted_reservation_order.
// Migration 814: 편집 함수는 API 전용 — service client 로 edit_submitted_reservation_order_for_user 를 호출하고 p_user_id 는 서버 세션 값만 쓴다(본문 값 사용 금지).
// 소유권·서명·결제 가드는 DB 함수가 p_user_id 기준으로 재검증한다.
// 수령 마감·최대 대여일 사전 검사는 RPC 소관이다(여기서 중복 구현하지 않는다) — RPC가 해당 reason을 내면 구분된 문구로 400 매핑만 한다.
export const POST: RequestHandler = async ({ locals, request }) => {
  // 서버가 JWT 로 재검증한 user 만 신뢰한다 — 쿠키에 저장된 session.user 는 검증 대상이 아니라 위조될 수 있다(sp5 SEC-A, service_role 대행 호출이라 특히 중요).
  const { session, user } = await locals.safeGetSession()
  if (!session || !user) return json({ error: '로그인이 필요해요.' }, { status: 401 })
  const userId = user.id

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return json({ error: '요청 내용이 올바르지 않아요.' }, { status: 400 })
  }
  const input = parseEditOrderBody(rawBody)
  if (!input) return json({ error: '요청 내용이 올바르지 않아요.' }, { status: 400 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: EDIT_ORDER_GENERIC_FAILURE.error }, { status: 500 })
  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const allowed = await takeRate(admin, { bucket: 'edit_order_user', key: userId, windowSeconds: 60, max: 10 })
  if (!allowed) return json({ error: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.' }, { status: 429 })

  let rpcData: unknown
  try {
    const { data, error } = await admin.rpc('edit_submitted_reservation_order_for_user' as never, {
      p_user_id: userId,
      p_reservation_id: input.reservationId,
      p_expected_reservation_ids: input.expectedReservationIds,
      p_lines: input.lines,
      p_selected_coupon_ids: input.selectedCouponIds,
      p_selected_points: input.selectedPoints,
    } as never)
    if (error) {
      console.error('[reservations/edit-order] RPC 오류:', (error as { code?: string }).code ?? 'unknown')
      return json({ error: EDIT_ORDER_GENERIC_FAILURE.error }, { status: 500 })
    }
    rpcData = data
  } catch {
    console.error('[reservations/edit-order] RPC 예외')
    return json({ error: EDIT_ORDER_GENERIC_FAILURE.error }, { status: 500 })
  }

  const result = interpretEditOrderResult(rpcData)
  if (!result.ok) return json({ error: result.failure.error }, { status: result.failure.status })
  const { cancelledReservationIds, ...publicBody } = result.value

  // 대여 액션 로그(fail-soft) — 옛 예약마다 1건 + 새 대표 예약 1건
  const note = `edit_order:새 예약 ${publicBody.reservation_ids.join(',')}로 교체`
  const logTargets = [...cancelledReservationIds]
  if (publicBody.reservation_ids.length > 0) logTargets.push(publicBody.reservation_ids[0])
  await Promise.allSettled(
    logTargets.map(async (reservationId) => {
      await admin.rpc('log_rental_action', {
        p_reservation_id: reservationId,
        p_action_type: 'customer_edit_order',
        p_admin_id: userId,
        p_note: note,
      })
    }),
  )

  // 관리자 푸시만(고객 푸시·SMS 없음, fail-soft)
  try {
    const { data: profile } = await admin.from('user_profiles').select('full_name').eq('id', userId).maybeSingle()
    const rawName = (profile as { full_name?: string | null } | null)?.full_name
    // eslint-disable-next-line no-control-regex
    const customerName = (typeof rawName === 'string' ? rawName.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 20) : '') || '고객'
    await sendPushToAdmins('new_reservation', {
      title: '예약 신청이 수정됐어요',
      body: `${customerName}님이 예약 ${publicBody.reservation_code ?? ''} 내용을 수정했어요.`,
      link: '/cms/reservation',
    })
  } catch {
    // 관리자 푸시 실패는 무시
  }

  return json(publicBody)
}
