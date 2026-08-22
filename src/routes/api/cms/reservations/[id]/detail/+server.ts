// GET /api/cms/reservations/[id]/detail — RentalDetailPanel.svelte의 row prop 형태로
// 예약 1건 단건 조회. get_rental_list(p_reservation_id=...) 필터(Migration 327)를 사용해
// /cms/reservation·/cms/rentals 목록 화면과 완전히 동일한 데이터 형태를 재사용한다(중복
// 쿼리/조인 로직 작성 금지 원칙).
//
// 배경: 채팅 대화카드(ActionCard.svelte) CTA를 관리자가 클릭하면 RentalDetailPanel을 CMS
// 목록 화면 전체가 아니라 이 컴포넌트만 모달에 직접 마운트해 보여준다(AdminChatPanel.svelte
// 참고) — 그 컴포넌트가 필요로 하는 row 데이터를 여기서 채운다.

import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

export const GET: RequestHandler = async ({ params, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })

  const reservationId = Number(params.id)
  if (!Number.isFinite(reservationId)) {
    return json({ error: '잘못된 예약 id입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data, error } = await admin.rpc('get_rental_list', {
    p_status: null,
    p_page: 1,
    p_per_page: 1,
    p_reservation_id: reservationId,
  })

  if (error) return json({ error: error.message }, { status: 500 })

  const row = data?.[0] ?? null
  if (!row) return json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 })

  return json({ row })
}
