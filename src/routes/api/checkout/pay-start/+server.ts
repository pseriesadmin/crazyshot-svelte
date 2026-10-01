import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { loadDirectPayOrder, ensureDirectPayDeadline, hasEnoughPayTime } from '$lib/server/checkout/directPay'
import type { RequestHandler } from './$types'

// 판매전용 단독 주문 직접결제 시작 — 장바구니 [결제하기]가 주문 생성 직후 호출 (2026-10-01)
// 서버가 저장한 최종 결제금액·주문명을 돌려주고(화면 계산값과 대조하는 용도), 미결제 이탈 30분 마감을 이때 처음 설정한다(연장 없음).
// 판매전용 단독이 아니거나 소유자가 아니면 거부한다 — 대여 포함 주문은 이 경로를 쓰지 않는다.
export const POST: RequestHandler = async ({ locals, request }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as { orderId?: unknown }
  const orderId = Number(body.orderId)
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const loaded = await loadDirectPayOrder(admin, orderId, session.user.id)
  if (!loaded.ok) {
    return json({ ok: false, error: '결제할 수 없는 주문입니다.', code: loaded.code }, { status: loaded.code === 'NOT_OWNER' ? 403 : 400 })
  }
  const order = loaded.order
  const expiresAt = await ensureDirectPayDeadline(admin, orderId, order.expiresAt)
  // 결제 가능 시간이 거의 끝난 주문은 결제창을 열지 않는다(승인 직후 자동 만료와 겹치는 경합 방지) — 만료 후 장바구니에서 다시 신청
  if (!hasEnoughPayTime(expiresAt)) {
    return json({ ok: false, error: '결제 가능 시간이 거의 끝났어요. 신청이 자동 취소된 뒤 장바구니에서 다시 신청해 주세요.', code: 'PAY_WINDOW_CLOSING' }, { status: 400 })
  }

  const { data: profile } = await admin.from('user_profiles').select('full_name, email').eq('id', session.user.id).maybeSingle()
  const p = profile as { full_name: string | null; email: string | null } | null
  const names = order.productNames
  const orderName = (names.length > 1 ? `${names[0]} 외 ${names.length - 1}건` : (names[0] ?? '크레이지샷 상품 구매')).slice(0, 100)

  return json({
    ok: true,
    orderId,
    finalAmount: order.finalAmount,
    orderName,
    expiresAt,
    customerName: p?.full_name ?? null,
    customerEmail: p?.email ?? session.user.email ?? null,
  })
}
