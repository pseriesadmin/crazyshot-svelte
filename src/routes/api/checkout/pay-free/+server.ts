import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { loadDirectPayOrder, finalizeDirectPayment, buildPaidSuccessQuery } from '$lib/server/checkout/directPay'
import type { RequestHandler } from './$types'

// 판매전용 단독 주문 — 쿠폰·포인트로 결제금액이 0원이 된 경우 결제창 없이 바로 확정 (2026-10-01)
// 계약서명 흐름의 api/contracts/[token]/pay-mock(0원 분기)과 같은 확정 RPC를 쓰되 로그인 세션 + 주문 소유로 인증한다.
// 금액은 서버에 저장된 orders.final_amount만 본다 — 0원이 아니면 거부(유료 주문을 이 경로로 우회 확정할 수 없다).
export const POST: RequestHandler = async ({ locals, request }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as { orderId?: unknown }
  const orderId = Number(body.orderId)
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const loaded = await loadDirectPayOrder(admin, orderId, session.user.id)
  if (!loaded.ok) {
    if (loaded.code === 'ALREADY_PAID') return json({ ok: true, alreadyProcessed: true })
    return json({ ok: false, error: '결제할 수 없는 주문입니다.', code: loaded.code }, { status: loaded.code === 'NOT_OWNER' ? 403 : 400 })
  }
  const order = loaded.order
  if (order.finalAmount !== 0) {
    return json({ ok: false, error: '결제금액이 0원이 아닌 주문입니다.', code: 'NOT_FREE' }, { status: 400 })
  }

  const { data: confirmedIds, error: rpcErr } = await admin.rpc('mark_reservation_payment_confirmed_order', {
    p_reservation_id: order.primaryReservationId,
  })
  if (rpcErr) {
    console.error('[checkout/pay-free] mark_reservation_payment_confirmed_order 실패:', rpcErr)
    return json({ ok: false, error: '결제 처리 중 오류가 발생했습니다.' }, { status: 500 })
  }
  if (!((confirmedIds ?? []) as number[]).includes(order.primaryReservationId)) {
    return json({ ok: false, error: '주문 확정에 실패했습니다.' }, { status: 500 })
  }

  const { couponError } = await finalizeDirectPayment(admin, { userId: session.user.id, order, paidAmount: 0 })
  const successQuery = await buildPaidSuccessQuery(admin, order, null)
  return json({ ok: true, couponError, successQuery })
}
