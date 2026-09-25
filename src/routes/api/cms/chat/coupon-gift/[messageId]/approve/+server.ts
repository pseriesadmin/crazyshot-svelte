// POST /api/cms/chat/coupon-gift/[messageId]/approve
// 관리자가 pending 쿠폰선물 카드를 승인 또는 거절
// body: { reject?: boolean }
//
// 핵심: distribute_coupon의 is_cms_user() 검증이 auth.uid() 기반이므로
//       locals.supabase(관리자 실세션)으로 RPC 호출 — service_role 금지
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createClient } from '@supabase/supabase-js'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { sendPushToUser } from '$lib/server/push'
import {
  COUPON_ALREADY_GIFTED_MESSAGE,
  isCouponAlreadyOwned,
  insertDuplicateGiftWarning,
} from '$lib/server/couponGiftDuplicate'

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '쿠폰 발급 권한(manager 이상)이 필요합니다.' }, { status: 403 })

  const messageId = params.messageId
  if (!messageId) return json({ error: 'messageId가 필요합니다.' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const reject = body?.reject === true

  // 대기 카드 승인 시 이미 보유한 동일 쿠폰이면 배포·고객 알림 없이 관리자 전용 경고 카드만 남기고 차단
  // (카드는 대기 상태로 유지 — 관리자가 거절 처리 가능). 조회 실패 시엔 기존 흐름 그대로 진행.
  if (!reject) {
    try {
      const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
      if (serviceRoleKey) {
        const admin = createClient(PUBLIC_SUPABASE_URL, serviceRoleKey)
        const { data: msg } = await admin
          .from('chat_messages')
          .select('session_id, action_payload, chat_sessions(user_id)')
          .eq('id', messageId)
          .maybeSingle()
        const row = msg as {
          session_id?: string
          action_payload?: { coupon_id?: string; approval_status?: string; discount_label?: string } | null
          chat_sessions?: { user_id?: string } | { user_id?: string }[] | null
        } | null
        const sess = Array.isArray(row?.chat_sessions) ? row?.chat_sessions[0] : row?.chat_sessions
        const payload = row?.action_payload
        const pending = payload?.approval_status !== 'approved' && payload?.approval_status !== 'rejected'
        if (pending && row?.session_id && sess?.user_id && payload?.coupon_id &&
            await isCouponAlreadyOwned(admin, sess.user_id, payload.coupon_id)) {
          await insertDuplicateGiftWarning(admin, row.session_id, payload.discount_label)
          return json({ error: COUPON_ALREADY_GIFTED_MESSAGE, duplicate: true }, { status: 409 })
        }
      }
    } catch (e) {
      console.error('[coupon-gift/approve] 중복 선물 사전확인 실패(fail-soft):', e instanceof Error ? e.message : e)
    }
  }

  // locals.supabase = 관리자의 실제 인증 세션 — auth.uid() = 관리자 UID → is_cms_user() 통과
  // Supabase 생성 타입에 신규 RPC가 없으므로 unknown 경유 캐스트
  const { data, error } = await (locals.supabase.rpc as unknown as (
    fn: string, args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>)('approve_pending_coupon_gift', {
    p_message_id: messageId,
    p_admin_id:   session.user.id,
    p_reject:     reject,
  })

  if (error) {
    return json({ error: `RPC 오류: ${error.message}` }, { status: 500 })
  }

  const result = data as { ok: boolean; error?: string; rejected?: boolean; coupon_code?: string } | null
  if (!result?.ok) {
    return json({ error: result?.error ?? '처리에 실패했습니다.' }, { status: 422 })
  }

  // 승인(거절 아님) 시 고객 브라우저 푸시 — direct-send와 동일 문구·스위치(event_coupon_issued).
  // 카드 갱신은 이미 커밋됐으므로 푸시 실패는 fail-soft(승인 응답에 영향 없음).
  if (!result.rejected) {
    try {
      const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
      if (serviceRoleKey) {
        const admin = createClient(PUBLIC_SUPABASE_URL, serviceRoleKey)
        const { data: msg } = await admin
          .from('chat_messages')
          .select('action_payload, chat_sessions(user_id)')
          .eq('id', messageId)
          .maybeSingle()
        const row = msg as {
          action_payload?: { discount_label?: string } | null
          chat_sessions?: { user_id?: string } | { user_id?: string }[] | null
        } | null
        const sess = Array.isArray(row?.chat_sessions) ? row?.chat_sessions[0] : row?.chat_sessions
        const userId = sess?.user_id
        const discountLabel = row?.action_payload?.discount_label
        if (userId) {
          await sendPushToUser(userId, 'event_coupon_issued', {
            title: '쿠폰이 도착했어요 🎁',
            body: discountLabel
              ? `${discountLabel} 쿠폰을 받으셨어요! 지금 확인해보세요.`
              : '쿠폰을 받으셨어요! 지금 확인해보세요.',
            link: '/account/profile?tab=coupon',
          })
        }
      }
    } catch (e) {
      console.error('[coupon-gift/approve] 고객 푸시 실패(fail-soft):', e instanceof Error ? e.message : e)
    }
  }

  return json({ ok: true, rejected: result.rejected ?? false, coupon_code: result.coupon_code })
}
