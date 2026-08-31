import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { isContractIssueBlocked } from '$lib/utils/contractIssueGuard'

export const POST: RequestHandler = async ({ params, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  // P7-3: manager 이상만 허용
  if (!cmsRole || !hasSettingsAccess(cmsRole)) return json({ error: '권한 없음' }, { status: 403 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 예약에서 user_id + status 조회
  const { data: res, error: resErr } = await admin
    .from('rental_reservations')
    .select('user_id, status')
    .eq('id', reservationId)
    .maybeSingle()

  if (resErr || !res) return json({ error: '예약 정보를 찾을 수 없습니다.' }, { status: 404 })

  if (isContractIssueBlocked(res.status)) {
    return json({ error: '취소되었거나 만료된 예약은 계약서를 발행할 수 없습니다.' }, { status: 422 })
  }

  // 2026-08-31(Stephen 확정): '예약' 단위 = '주문' 단위 — 장바구니에 상품이 몇 개 담기든
  // 하나의 예약신청(주문)에는 전자계약이 정확히 1건만 존재해야 한다. 이 예약이 속한 주문에
  // 이미 다른 상품(형제 행) 쪽에서 발행된 계약이 있으면 새로 만들지 않고 그 계약을 그대로
  // 재사용한다 — 상품별로 각각 "계약서 발송"을 눌러도 계약서·서명링크·결제 트리거가
  // 여러 개로 쪼개지지 않도록 하기 위함(toss_payments_pg_integration_2026-08-30.md 후속
  // 지적 — 개별결제 정책은 현재 사용하지 않음).
  const { data: orderItem } = await admin
    .from('order_items')
    .select('order_id')
    .eq('reservation_id', reservationId)
    .maybeSingle()

  const sameOrderReservationIds: number[] = [reservationId]
  if (orderItem?.order_id) {
    const { data: siblingItems } = await admin
      .from('order_items')
      .select('reservation_id')
      .eq('order_id', orderItem.order_id)
    for (const item of (siblingItems ?? []) as { reservation_id: number | null }[]) {
      if (item.reservation_id != null && !sameOrderReservationIds.includes(item.reservation_id)) {
        sameOrderReservationIds.push(item.reservation_id)
      }
    }
  }

  // 이미 존재하면 재사용 (idempotent) — 이 예약 자신뿐 아니라 같은 주문의 다른 상품(예약
  // 행)에 걸린 계약도 함께 확인. 가장 먼저 발행된 계약을 정본으로 삼는다.
  const { data: existing } = await admin
    .from('contracts')
    .select('id')
    .in('reservation_id', sameOrderReservationIds)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (existing) return json({ contractId: existing.id })

  const { data: contract, error: insertErr } = await admin
    .from('contracts')
    .insert({
      reservation_id: reservationId,
      user_id:        res.user_id,
      contract_type:  'rental',
    })
    .select('id')
    .single()

  if (insertErr || !contract) {
    return json({ error: insertErr?.message ?? '계약서 생성 실패' }, { status: 500 })
  }

  return json({ contractId: contract.id })
}
