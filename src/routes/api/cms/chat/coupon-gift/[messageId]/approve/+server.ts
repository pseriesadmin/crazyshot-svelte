// POST /api/cms/chat/coupon-gift/[messageId]/approve
// 관리자가 pending 쿠폰선물 카드를 승인 또는 거절
// body: { reject?: boolean }
//
// 핵심: distribute_coupon의 is_cms_user() 검증이 auth.uid() 기반이므로
//       locals.supabase(관리자 실세션)으로 RPC 호출 — service_role 금지
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'

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

  return json({ ok: true, rejected: result.rejected ?? false, coupon_code: result.coupon_code })
}
