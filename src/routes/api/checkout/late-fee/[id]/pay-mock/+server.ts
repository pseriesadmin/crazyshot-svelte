import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { validateLateFeeAccess } from '$lib/server/lateFeeUtils'
import { notifyLateFeePaid } from '$lib/server/lateFeeNotify'
import type { RequestHandler } from './$types'

// 연체료 결제 (임시 자동승인)
// confirm-mock/+server.ts와 동일한 "버튼 클릭 → 즉시 서버 처리" 패턴
// 실제 토스 연동(S1-M3 BLOCKED)과 무관 — PG 미연동 시범서비스용

export const POST: RequestHandler = async ({ params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ success: false, error: '인증 필요' }, { status: 401 })

  const lateFeeId = params.id
  if (!lateFeeId) {
    return json({ success: false, error: '연체료 ID가 필요합니다.' }, { status: 400 })
  }

  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY)

  // 소유권 + 중복결제 방지 검증 (lateFeeUtils 헬퍼 사용)
  const validation = await validateLateFeeAccess(lateFeeId, session.user.id, admin)
  if (!validation.ok) {
    return json({ success: false, error: validation.error }, { status: validation.status })
  }

  // RPC로 결제 처리 (RPC 내부가 auth.uid() 기준으로 소유권을 재검증하므로 반드시
  // locals.supabase(관리자/고객 실세션)로 호출해야 함 — service_role로 호출하면 auth.uid()가
  // NULL이라 RPC가 항상 401을 반환한다. 2026-08-16 QA 재검증: p_user_id를 클라이언트가 직접
  // 넘기던 구조는 타인 UUID를 알면 대신 결제완료 처리할 수 있는 약점이라 제거함)
  type PayRpcResult = { ok: boolean; error?: string; fee_amount?: number; status?: number }
  const { data: rpcResult, error: rpcErr } = await (locals.supabase.rpc as unknown as (
    fn: string, args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>)('pay_late_fee_mock', {
    p_late_fee_id: lateFeeId,
  })

  if (rpcErr) {
    console.error('[late-fee/pay-mock] pay_late_fee_mock RPC 실패:', rpcErr)
    return json({ success: false, error: '결제 처리 중 오류가 발생했습니다.' }, { status: 500 })
  }

  const result = rpcResult as PayRpcResult | null
  if (!result?.ok) {
    const status = result?.status ?? 500
    return json({ success: false, error: result?.error ?? '결제 실패' }, { status })
  }

  // 결제 완료 알림 — 채팅 대화카드 + 푸시 + 문자(공용 함수, 2026-11-02 Stephen 지시). 세션 조회는 공용 함수 안에서
  // find_or_create_general_chat_session RPC 경유(결함A/B-2·coupon-gift와 동일 유형의 세션단절 방지, reservation-rental-execution.md §0-3).
  // 모든 단계가 fail-soft라 알림 실패가 결제 응답에 영향을 주지 않는다.
  await notifyLateFeePaid(admin, {
    lateFeeId:     lateFeeId,
    reservationId: validation.lateFee.reservation_id,
    feeAmount:     validation.lateFee.fee_amount,
    userId:        session.user.id,
  })

  return json({
    success:    true,
    fee_amount: validation.lateFee.fee_amount,
    hours_late: validation.lateFee.hours_late,
  })
}
