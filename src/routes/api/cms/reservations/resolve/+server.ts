// GET /api/cms/reservations/resolve?id=... 또는 ?code=... 또는 ?late_fee_id=... —
// 예약 id·코드·연체료id → {id, status} 단건 조회
//
// 배경: 채팅 대화카드(ActionCard.svelte) CTA를 관리자가 클릭하면, 그 예약이 예약단계(hold 등,
// /cms/reservation 소관)인지 대여 라이프사이클(confirmed 이후, /cms/rentals 소관)인지에 따라
// 서로 다른 CMS 화면으로 안내해야 한다(rental-lifecycle.md — 두 화면은 상태 도메인이 배타적으로
// 분리돼 있음). 대화카드 payload에는 reservation_id·reservation_no(예약코드)·late_fee_id
// (연체료 결제 카드는 예약 식별자를 직접 갖지 않고 late_fees.reservation_id로만 연결됨) 중
// 하나만 있는 경우가 있고, 상태값 자체는 아예 없어 클라이언트에서 바로 판단할 수 없으므로 이
// 단건 조회로 최신 status를 확인한다. RPC/마이그레이션 변경 없음 — 단순 조회 2단계.

import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals, url }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })

  const idParam = url.searchParams.get('id')
  const codeParam = url.searchParams.get('code')
  const lateFeeIdParam = url.searchParams.get('late_fee_id')
  if (!idParam && !codeParam && !lateFeeIdParam) {
    return json({ error: 'id, code, late_fee_id 중 하나가 필요합니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  let resolvedId = idParam ? Number(idParam) : null
  if (!resolvedId && lateFeeIdParam) {
    const { data: fee, error: feeError } = await admin
      .from('late_fees')
      .select('reservation_id')
      .eq('id', lateFeeIdParam)
      .maybeSingle()
    if (feeError) return json({ error: feeError.message }, { status: 500 })
    if (!fee) return json({ error: '연체료 내역을 찾을 수 없습니다.' }, { status: 404 })
    resolvedId = fee.reservation_id
  }

  // 2026-08-31(Migration 400): reservation_code가 이제 같은 주문(여러 상품)의 예약 전체가
  // 공유하는 값이라 code만으로는 여러 행이 매칭될 수 있다 — 가장 먼저 생성된 예약(대표
  // 예약과 동일한 결정 기준, create_reservation_order 참고)을 결정론적으로 선택한다.
  let query = admin.from('rental_reservations').select('id, status').order('id', { ascending: true }).limit(1)
  query = resolvedId != null ? query.eq('id', resolvedId) : query.eq('reservation_code', codeParam as string)

  const { data, error } = await query.maybeSingle()
  if (error) return json({ error: error.message }, { status: 500 })
  if (!data) return json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 })

  return json({ id: data.id, status: data.status })
}
