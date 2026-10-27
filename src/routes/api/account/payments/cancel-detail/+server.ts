/**
 * GET /api/account/payments/cancel-detail?reservationId=
 *
 * 마이페이지 '카드 취소내역 보기' — 고객 본인 예약의 카드 취소(승인취소·부분취소) 내역을 돌려준다 (2026-10-26).
 *  - 전액 취소이고 DB 에 PG 취소 시각이 있으면 DB 값을 쓰고, 부분취소·시각 없음만 토스 결제 조회(GET /v1/payments/{paymentKey})로 가져온다(실패 시 DB 값).
 *  - 소유권: 예약 user_id + 결제 행 user_id 가 모두 로그인 사용자여야 한다(IDOR 방지, 비어 있으면 거절). 취소 결제가 아니면 404.
 *  - 취소 사유는 응답에 싣지 않는다(관리자 입력 문구 — Stephen 2026-10-26).
 *  - ⛔ 응답에는 결제 키·secret·카드번호를 싣지 않는다(buildCancelDetail 이 골라낸 값만).
 */
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { env } from '$env/dynamic/private'
import type { RequestHandler } from './$types'
import { findOrderPaymentTransaction } from '$lib/server/findOrderPaymentTransaction'
import { summarizeTossPayment, type PgCancelSummary, type TossPaymentLike } from '$lib/utils/pgCancelStatus'
import { buildCancelDetail, isCancelDetailAvailable, type ReceiptTxRow } from '$lib/utils/paymentReceipt'

/** 결제·취소 정보 응답은 캐시하지 않는다 */
const NO_STORE = { 'Cache-Control': 'no-store' }

export const GET: RequestHandler = async ({ locals, url }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401, headers: NO_STORE })

  const reservationId = Number(url.searchParams.get('reservationId'))
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return json({ ok: false, error: '예약 ID가 올바르지 않습니다.' }, { status: 400, headers: NO_STORE })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 1) 예약 소유 확인
  const { data: rv } = await admin.from('rental_reservations').select('user_id').eq('id', reservationId).maybeSingle()
  if ((rv as { user_id?: string } | null)?.user_id !== session.user.id) {
    return json({ ok: false, error: '조회할 수 없습니다.' }, { status: 403, headers: NO_STORE })
  }

  // 2) 결제 행(직접 또는 같은 주문 형제) + 결제 행 소유 확인 — 이미 읽은 행의 user_id 로 직접 비교(fail-closed: 비어 있어도 거절)
  const { data: txData, error: txErr } = await findOrderPaymentTransaction(admin, reservationId, { settledOnly: true })
  if (txErr) return json({ ok: false, error: '결제 정보를 불러오지 못했습니다.' }, { status: 500, headers: NO_STORE })
  const tx = txData as (ReceiptTxRow & { payment_key?: string | null; user_id?: string | null }) | null
  if (!tx || !isCancelDetailAvailable(tx)) {
    return json({ ok: false, error: '카드 취소 내역이 없습니다.' }, { status: 404, headers: NO_STORE })
  }
  if (tx.user_id !== session.user.id) {
    return json({ ok: false, error: '조회할 수 없습니다.' }, { status: 403, headers: NO_STORE })
  }
  const paymentKey = tx.payment_key ?? null

  // 3) 토스 조회는 꼭 필요할 때만(호출 수 최소화 — 결제 승인·환불과 같은 키를 쓴다):
  //    전액 취소이고 DB 에 PG 취소 시각이 이미 있으면 DB 값으로 충분하다. 부분취소·취소 시각 없음만 토스에 묻는다.
  let toss: PgCancelSummary | null = null
  const needToss = tx.status !== 'cancelled' || !tx.pg_cancelled_at
  const secret = env.TOSS_SECRET_KEY
  if (needToss && paymentKey && secret) {
    try {
      const res = await fetch(`https://api.tosspayments.com/v1/payments/${encodeURIComponent(paymentKey)}`, {
        headers: { Authorization: 'Basic ' + Buffer.from(`${secret}:`).toString('base64') },
        redirect: 'error',
        signal: AbortSignal.timeout(6000),
      })
      const body = await res.json().catch(() => null) as TossPaymentLike | null
      if (res.ok && body) toss = summarizeTossPayment(body)
    } catch {
      // fail-soft — DB 값으로 대체
    }
  }

  return json({ ok: true, detail: buildCancelDetail(tx, toss) }, { headers: NO_STORE })
}
