// POST /api/cms/chat/coupon-gift/direct-send
// 관리자가 쿠폰을 직접 선택해 즉시 발급 (승인 대기 없음)
// body: { session_id: string, coupon_id: string }
//
// 흐름: 관리자 인증 → 세션 user_id 확인 → distribute_coupon(locals.supabase) →
//       COUPON_GIFT_CARD 메시지 INSERT(service_role)
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createClient } from '@supabase/supabase-js'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '쿠폰 발급 권한(manager 이상)이 필요합니다.' }, { status: 403 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류입니다.' }, { status: 500 })

  const body = await request.json().catch(() => null)
  const sessionId = (body?.session_id as string | undefined)?.trim() ?? ''
  const couponId  = (body?.coupon_id  as string | undefined)?.trim() ?? ''

  if (!sessionId || !couponId) {
    return json({ error: 'session_id와 coupon_id는 필수입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, serviceRoleKey)

  // 세션 확인 및 user_id 조회 (service_role로 — RLS 우회)
  const { data: chatSession, error: sessionErr } = await admin
    .from('chat_sessions')
    .select('id, user_id, status')
    .eq('id', sessionId)
    .single()

  if (sessionErr || !chatSession) {
    return json({ error: '세션을 찾을 수 없습니다.' }, { status: 404 })
  }

  const userId = (chatSession as { user_id: string }).user_id

  // 쿠폰 정보 조회 (service_role)
  const { data: couponRaw, error: couponErr } = await admin
    .from('coupons')
    .select('id, code, discount_type, discount_value')
    .eq('id', couponId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .lte('valid_from', new Date().toISOString())
    .gte('valid_until', new Date().toISOString())
    .single()

  if (couponErr || !couponRaw) {
    return json({ error: '발급 가능한 쿠폰이 아닙니다.' }, { status: 404 })
  }

  const coupon = couponRaw as { id: string; code: string; discount_type: string; discount_value: number }
  const discountLabel =
    coupon.discount_type === 'percentage'
      ? `${coupon.discount_value}% 할인`
      : `${Number(coupon.discount_value).toLocaleString()}원 할인`

  // distribute_coupon: locals.supabase(관리자 실세션) 필수 — auth.uid() = 관리자 UID
  // Supabase 생성 타입에 이미 정의된 RPC지만 파라미터 타입 불일치 방어
  const { data: distResult, error: distErr } = await (locals.supabase.rpc as unknown as (
    fn: string, args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>)('distribute_coupon', {
    p_coupon_id:   coupon.id,
    p_target_type: 'specific_user',
    p_target_meta: { user_ids: [userId] },
    p_admin_id:    session.user.id,
  })

  if (distErr) {
    return json({ error: `쿠폰 발급 오류: ${distErr.message}` }, { status: 500 })
  }

  const distData = distResult as { ok?: boolean; error?: string } | null
  if (!distData?.ok) {
    return json({ error: distData?.error ?? '쿠폰 발급에 실패했습니다.' }, { status: 422 })
  }

  // COUPON_GIFT_CARD 메시지 INSERT — 즉시 발급이므로 approval_status 없음
  const actionPayload = {
    type: 'COUPON_GIFT_CARD',
    coupon_code: coupon.code,
    discount_label: discountLabel,
    action_url: '/account/profile?tab=coupon',
  }

  const { data: messageRaw, error: msgErr } = await admin
    .from('chat_messages')
    .insert({
      session_id:     sessionId,
      sender_type:    'admin',
      content:        `쿠폰을 보내드렸어요! (${discountLabel})`,
      message_type:   'action_card',
      action_payload: actionPayload,
      is_read:        false,
    })
    .select()
    .single()

  if (msgErr) {
    return json({ error: '메시지 전송 오류' }, { status: 500 })
  }

  // 세션 updated_at 갱신 (목록 순서 업데이트)
  await admin
    .from('chat_sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', sessionId)

  return json({ ok: true, message: messageRaw })
}
