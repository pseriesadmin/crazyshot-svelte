import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { loadContractPayOrder, buildContractTossOrderId } from '$lib/server/checkout/contractPay'
import type { RequestHandler } from './$types'

// 계약서 결제 시작(서버 사전등록) — 토스 결제창을 열기 직전 호출 (2026-10-04)
// 서버가 저장한 최종 결제금액과 이 주문에 묶인 토스 orderId를 돌려준다. 클라이언트는 이 값으로만 결제창을 연다.
// 인증: pay-mock·pay-result와 같은 계약 토큰 기반(서명 완료한 계약의 결제 단계 전용). 평소에는 읽기 전용이며,
// 보유 포인트가 부족해진 주문에 한해서만 주문 금액을 재보정(sync)한다(아래 참고).
export const POST: RequestHandler = async ({ params }) => {
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  let loaded = await loadContractPayOrder(admin, params.token)
  if (!loaded.ok) {
    return json({ ok: false, error: '결제를 시작할 수 없는 상태입니다.', code: loaded.code }, { status: loaded.status })
  }

  // 보유 포인트 확인 (2026-10-04, sp3 M-2 (b)): 신청 이후 잔액이 줄어 저장된 사용 포인트를 차감할 수 없게 됐다면
  // 결제창을 열기 전에 주문을 현재 잔액 기준으로 재보정한다(결제 후 차감 실패로 포인트 없이 확정되는 손실 방지).
  // 금액이 바뀌었음을 알리면 고객이 새 결제금액을 확인한 뒤 다시 시도한다. 변경이 없으면 이 엔드포인트는 쓰기 없음.
  let pointsAdjusted = false
  if (loaded.selectedPoints > 0 && loaded.userId) {
    const { data: profile, error: profileErr } = await admin.from('user_profiles').select('points').eq('id', loaded.userId).maybeSingle()
    // 조회 오류를 잔액 0으로 오해하지 않는다(일시 장애로 사용 포인트가 0으로 재보정되는 것을 방지)
    if (profileErr) {
      console.error('[contracts/pay-start] 보유 포인트 조회 실패:', profileErr.message)
      return json({ ok: false, error: '결제 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.', code: 'BALANCE_CHECK_FAILED' }, { status: 500 })
    }
    const balance = Number((profile as { points: number | null } | null)?.points ?? 0)
    if (balance < loaded.selectedPoints) {
      const { data: syncData, error: syncErr } = await admin.rpc('sync_order_after_composition_change', { p_order_id: loaded.orderId })
      const syncRow = (Array.isArray(syncData) ? syncData[0] : syncData) as { success?: boolean } | null
      if (syncErr || !syncRow?.success) {
        console.error('[contracts/pay-start] 포인트 재보정 실패:', syncErr?.message ?? 'sync success=false')
        return json({ ok: false, error: '결제 금액을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.', code: 'SYNC_FAILED' }, { status: 500 })
      }
      pointsAdjusted = true
      loaded = await loadContractPayOrder(admin, params.token)
      if (!loaded.ok) {
        return json({ ok: false, error: '결제를 시작할 수 없는 상태입니다.', code: loaded.code, pointsAdjusted }, { status: loaded.status })
      }
    }
  }

  return json({
    ok: true,
    finalAmount: loaded.finalAmount,
    orderName: loaded.orderName,
    tossOrderId: buildContractTossOrderId(loaded.orderId),
    pointsAdjusted,
  })
}
