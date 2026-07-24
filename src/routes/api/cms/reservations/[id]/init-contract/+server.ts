import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

export const POST: RequestHandler = async ({ params, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 이미 존재하면 재사용 (idempotent)
  const { data: existing } = await admin
    .from('contracts')
    .select('id')
    .eq('reservation_id', reservationId)
    .is('deleted_at', null)
    .maybeSingle()

  if (existing) return json({ contractId: existing.id })

  // 예약에서 user_id 조회
  const { data: res, error: resErr } = await admin
    .from('rental_reservations')
    .select('user_id')
    .eq('id', reservationId)
    .maybeSingle()

  if (resErr || !res) return json({ error: '예약 정보를 찾을 수 없습니다.' }, { status: 404 })

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
