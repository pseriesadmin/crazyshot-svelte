// GET /api/cms/reservations/[id]/payment/pg-status
// 결제정보 탭 "PG 결제 정보"의 취소 실행 상태 — Toss 결제 조회 API를 실시간으로 호출해 PG 쪽 실제 상태를 보여준다
// (DB의 payment_transactions.status와 별개 — 관리자가 취소확인 전에 PG 취소가 실제로 실행됐는지 대조하는 용도).
// 조회 전용·fail-soft: Toss 조회가 실패해도 오류 응답 대신 { ok:false, reason }을 돌려 화면이 "조회 불가"로 표시한다.
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { env } from '$env/dynamic/private'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { findOrderPaymentTransaction } from '$lib/server/findOrderPaymentTransaction'
import { summarizeTossPayment, type TossPaymentLike } from '$lib/utils/pgCancelStatus'

export const GET: RequestHandler = async ({ params, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: tx, error } = await findOrderPaymentTransaction(admin, reservationId)
  if (error) return json({ ok: false, reason: 'db_error' })

  const paymentKey = (tx as { payment_key?: string | null } | null)?.payment_key
  if (!paymentKey) return json({ ok: false, reason: 'no_payment' })

  const secret = env.TOSS_SECRET_KEY
  if (!secret) return json({ ok: false, reason: 'not_configured' })

  try {
    const res = await fetch(`https://api.tosspayments.com/v1/payments/${encodeURIComponent(paymentKey)}`, {
      headers: { Authorization: 'Basic ' + Buffer.from(`${secret}:`).toString('base64') },
      signal: AbortSignal.timeout(6000),
    })
    const body = await res.json().catch(() => null) as (TossPaymentLike & { message?: string }) | null
    if (!res.ok || !body) {
      // 모의결제(mock) 키 등 Toss에 존재하지 않는 결제는 404 — 조회 불가로만 표시
      return json({ ok: false, reason: res.status === 404 ? 'not_found_in_pg' : 'pg_error' })
    }
    return json({ ok: true, ...summarizeTossPayment(body) })
  } catch {
    return json({ ok: false, reason: 'pg_unreachable' })
  }
}
