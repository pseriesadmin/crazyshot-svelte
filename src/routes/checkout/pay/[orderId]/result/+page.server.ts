// Toss 결제 성공 리다이렉트 수신 → 판매전용 단독 주문 결제 확정 (2026-10-01)
// 플로우: Toss successUrl → (로그인 세션 + 주문 소유 확인) → 금액 대조 → Toss confirm API →
//         confirm_order_payment_and_update_reservations(서명 없이 판매전용은 결제 확인만으로 confirmed) → 후처리 → 완료 화면
// 전자계약 흐름의 contract/[token]/pay-result와 같은 RPC·같은 멱등 보장(idempotency_key = Toss orderId)을 쓰되,
// 토큰 대신 로그인 세션으로 인증한다. 그 파일은 수정하지 않았다.
import { redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loadDirectPayOrder, finalizeDirectPayment, buildPaidSuccessQuery } from '$lib/server/checkout/directPay'
import type { PageServerLoad } from './$types'

const TOSS_CONFIRM_URL = 'https://api.tosspayments.com/v1/payments/confirm'
const SUCCESS_PAGE = '/payment/success/dev'

export const load: PageServerLoad = async ({ params, locals, url }) => {
  const { session } = await locals.safeGetSession()
  const orderId = Number(params.orderId)
  // 결제 실패 시 장바구니로 복귀(카트에서 실패 안내) — 이 주문의 hold는 30분 안에 다시 결제할 수 있다
  const failBase = `/cart?payStatus=fail`
  if (!session) throw redirect(303, '/auth/login?redirect=/cart')

  const paymentKey = url.searchParams.get('paymentKey') ?? ''
  const tossOrderId = url.searchParams.get('orderId') ?? ''
  const amount = Number(url.searchParams.get('amount') ?? '0')
  if (!paymentKey || !tossOrderId || !amount) throw redirect(303, `${failBase}&code=MISSING_PARAMS`)
  // 주문번호는 PostgREST 필터 문자열에 쓰이므로 형식을 검증한다(쉼표·괄호 등으로 필터 조작 방지)
  if (!/^[A-Za-z0-9_\-=.]{6,64}$/.test(tossOrderId)) throw redirect(303, `${failBase}&code=MISSING_PARAMS`)

  const tossSecretKey = env.TOSS_SECRET_KEY
  if (!tossSecretKey) throw redirect(303, `${failBase}&code=SERVER_ERROR`)

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const userId = session.user.id

  // 이중결제 방지 — 같은 Toss 주문번호로 이미 처리된 결제는 승인 재호출 없이 완료 처리
  const { data: existingPt } = await admin
    .from('payment_transactions')
    .select('id')
    .or(`idempotency_key.eq.${tossOrderId},order_id.eq.${tossOrderId}`)
    .maybeSingle()
  const loaded = await loadDirectPayOrder(admin, orderId, userId)
  if (!loaded.ok) {
    // 이미 처리된 결제(중복 복귀·새로고침)는 완료 화면으로 — 확정된 주문의 요약은 저장값으로 다시 조립
    if (existingPt || loaded.code === 'ALREADY_PAID') {
      throw redirect(303, await completedRedirect(admin, orderId, userId))
    }
    throw redirect(303, `${failBase}&code=${loaded.code}`)
  }
  if (existingPt) throw redirect(303, await completedRedirect(admin, orderId, userId))
  const order = loaded.order

  // 금액 대조 — 결제창에서 승인된 금액이 서버에 저장된 주문 최종금액과 다르면 승인하지 않는다
  if (amount !== order.finalAmount) throw redirect(303, `${failBase}&code=AMOUNT_MISMATCH`)

  const tossRes = await fetch(TOSS_CONFIRM_URL, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${tossSecretKey}:`).toString('base64'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentKey, orderId: tossOrderId, amount }),
  })
  const tossData = (await tossRes.json()) as Record<string, unknown>
  if (!tossRes.ok) {
    const code = (tossData.code as string) ?? 'TOSS_ERROR'
    const message = (tossData.message as string) ?? '결제 승인에 실패했습니다.'
    throw redirect(303, `${failBase}&code=${encodeURIComponent(code)}&message=${encodeURIComponent(message)}`)
  }

  const { data: rpcResult, error: confirmRpcErr } = await admin.rpc('confirm_order_payment_and_update_reservations', {
    p_order_id: order.orderId,
    p_reservation_ids: order.reservationIds,
    p_payment_key: paymentKey,
    p_toss_order_id: tossOrderId,
    p_idempotency_key: tossOrderId,
    p_total_amount: order.finalAmount,
    p_paid_amount: amount,
    p_point_amount: order.selectedPoints,
    p_coupon_discount: order.couponDiscount,
    p_payment_method: (tossData.method as string) ?? null,
    p_toss_response: tossData,
    p_calc_at: (tossData.approvedAt as string) ?? new Date().toISOString(),
  })

  if (confirmRpcErr) {
    // Toss는 이미 승인했는데 DB 반영이 실패한 위험 상태 — 운영자가 Toss 콘솔과 대조할 수 있게 상세 로그 + 관리자 알림(fail-soft)
    console.error('[checkout/pay/result] confirm_order_payment_and_update_reservations 실패 — Toss 결제는 이미 승인됨:', confirmRpcErr.message, {
      orderId: order.orderId, tossOrderId, paymentKey, amount,
    })
    try {
      const { sendPushToAdmins } = await import('$lib/server/push')
      await sendPushToAdmins('payment_completed', {
        title: '결제 확정 처리 실패 — 확인 필요',
        body: `주문 #${order.orderId}: Toss 결제는 완료됐으나 DB 반영에 실패했습니다. Toss 콘솔·예약상태를 직접 확인해주세요.`,
        link: `/cms/reservation?selected=${order.primaryReservationId}`,
      })
    } catch (pushErr) {
      console.error('[checkout/pay/result] 관리자 알림 오류(fail-soft):', pushErr instanceof Error ? pushErr.message : pushErr)
    }
  }

  const result = rpcResult as { success?: boolean; idempotent?: boolean; error?: string } | null
  if (!result?.success) {
    const errMsg = result?.error ?? confirmRpcErr?.message ?? '결제 처리 중 오류가 발생했습니다.'
    throw redirect(303, `${failBase}&code=RPC_ERROR&message=${encodeURIComponent(errMsg)}`)
  }

  if (!result.idempotent) {
    await finalizeDirectPayment(admin, { userId, order, paidAmount: amount })
  }

  const method = (tossData.method as string) ?? null
  throw redirect(303, `${SUCCESS_PAGE}?${await buildPaidSuccessQuery(admin, order, method)}`)
}

/** 결제 확정이 끝난 주문의 완료 화면 주소 — 확정 후에는 loadDirectPayOrder가 ALREADY_PAID라 주문 정보를 직접 읽어 조립한다 */
async function completedRedirect(admin: SupabaseClient, orderId: number, userId: string): Promise<string> {
  const { data: itemRows } = await admin.from('order_items').select('reservation_id').eq('order_id', orderId)
  const reservationIds = ((itemRows ?? []) as { reservation_id: number | null }[]).map((r) => r.reservation_id).filter((v): v is number => v != null).sort((a, b) => a - b)
  const { data: orderRow } = await admin.from('orders').select('user_id, final_amount, selected_points, coupon_discount_amount').eq('id', orderId).maybeSingle()
  const o = orderRow as { user_id: string | null; final_amount: number | null; selected_points: number | null; coupon_discount_amount: number | null } | null
  if (!o || o.user_id !== userId || reservationIds.length === 0) return '/cart'
  const { data: resRows } = await admin.from('rental_reservations').select('id, product_id').in('id', reservationIds)
  const productIds = ((resRows ?? []) as { id: number; product_id: string | null }[]).map((r) => r.product_id)
  const names: string[] = []
  for (const pid of productIds) {
    if (!pid) { names.push('상품'); continue }
    const { data: prod } = await admin.from('products').select('name, parent_product_id').eq('id', pid).maybeSingle()
    const pr = prod as { name: string; parent_product_id: string | null } | null
    let nm = pr?.name ?? '상품'
    if (pr?.parent_product_id) {
      const { data: par } = await admin.from('products').select('name').eq('id', pr.parent_product_id).maybeSingle()
      nm = (par as { name: string } | null)?.name ?? nm
    }
    names.push(nm)
  }
  const query = await buildPaidSuccessQuery(admin, {
    orderId,
    finalAmount: Number(o.final_amount ?? 0),
    selectedPoints: Number(o.selected_points ?? 0),
    couponDiscount: Number(o.coupon_discount_amount ?? 0),
    expiresAt: null,
    reservationIds,
    primaryReservationId: reservationIds[0],
    userCouponIds: [],
    productNames: names,
  }, null)
  return `${SUCCESS_PAGE}?${query}`
}
