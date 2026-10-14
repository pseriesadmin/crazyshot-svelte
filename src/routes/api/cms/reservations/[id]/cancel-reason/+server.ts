import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { CANCEL_REASON_NOTE_MAX, isCancelReasonCode } from '$lib/utils/cancelReason'
import type { RequestHandler } from './$types'

// 예약 상세 패널 "취소·환불 사유"(2026-10-14) — 선택(대표 사유 6종) + 추가 입력(200자) 자동 저장.
// GET: 현재 저장값 조회 / PUT: 저장(코드·메모 모두 비우면 삭제). 취소된 예약에만 저장되고 같은 주문의 취소된 형제에도 함께 쓴다(RPC).
function parseId(raw: string): number | null {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

export const GET: RequestHandler = async ({ params, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })
  const id = parseId(params.id)
  if (id === null) return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data, error } = await admin
    .from('rental_reservations')
    .select('status, cancel_reason_code, cancel_reason_note')
    .eq('id', id)
    .maybeSingle()
  if (error) return json({ error: error.message }, { status: 500 })
  if (!data) return json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 })
  const row = data as { status: string; cancel_reason_code: string | null; cancel_reason_note: string | null }
  return json({ code: row.cancel_reason_code, note: row.cancel_reason_note, editable: row.status === 'cancelled' })
}

export const PUT: RequestHandler = async ({ params, locals, request }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '인증 필요' }, { status: 401 })
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })
  const id = parseId(params.id)
  if (id === null) return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })

  const body = await request.json().catch(() => ({})) as { code?: unknown; note?: unknown }
  const code = body.code === null || body.code === undefined || body.code === '' ? null : body.code
  if (code !== null && !isCancelReasonCode(code)) return json({ error: '사유 항목이 올바르지 않습니다.' }, { status: 400 })
  const note = typeof body.note === 'string' ? body.note : ''
  if ([...note.trim()].length > CANCEL_REASON_NOTE_MAX) {
    return json({ error: `추가 사유는 ${CANCEL_REASON_NOTE_MAX}자 이내로 입력해 주세요.` }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data, error } = await admin.rpc('cms_set_reservation_cancel_reason', {
    p_reservation_id: id, p_code: code, p_note: note,
  })
  if (error) return json({ error: error.message }, { status: 500 })
  const res = data as { ok?: boolean; error?: string } | null
  if (!res?.ok) {
    const msg = res?.error === 'not_cancelled' ? '취소된 예약에만 사유를 저장할 수 있습니다.'
      : res?.error === 'not_found' ? '예약을 찾을 수 없습니다.' : '저장하지 못했습니다.'
    return json({ error: msg }, { status: 400 })
  }
  return json({ ok: true })
}
