import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { RETURN_EVIDENCE_BUCKET } from '$lib/server/returnSubmission'
import { loadReturnInspectionItems } from '$lib/server/returnInspectionItems'
import { ADMIN_RETURN_STATUSES, validateAdminReturnEntry } from '$lib/server/returnAdminEntry'

// 반납정보 관리자 직접 등록 (Migration #737, 2026-10-22, Stephen 지시)
// 반납정보(사진·체크리스트·메모)를 관리자 계정이 직접 등록한다(방문·택배·퀵·무인함 등 반납 방식 무관, 2026-10-22 확대). 목록 조회는 return-evidence GET 이 함께 내려준다.
// 대여중이면 고객 제출과 같이 반납중(return_requested)으로 전환한다(update_reservation_status 직접 호출 — AUTO_NOTIFY 카드 미발송).
// 보안: 메뉴 rental.reservation + CMS 직원 + 허용 상태 + 본문·파일 존재 재검증. 저장은 서비스 롤(테이블 RLS 정책 없음).
export const POST: RequestHandler = async ({ params, request, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: 'Unauthorized' }, { status: 401 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  // 관리자 등록은 고객검수 여부와 무관하게 활성 검수 항목 전체를 허용
  const { active } = await loadReturnInspectionItems(admin)
  const parsed = validateAdminReturnEntry(reservationId, body, active)
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 })
  const input = parsed.value

  const { data: res } = await admin.from('rental_reservations').select('status').eq('id', reservationId).maybeSingle()
  if (!res) return json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 })
  const r = res as { status: string }
  if (!ADMIN_RETURN_STATUSES.has(r.status)) return json({ error: '지금은 반납정보를 등록할 수 없는 상태입니다.' }, { status: 409 })

  // 올렸다고 주장하는 파일이 실제로 버킷에 있는지 확인(경로 형식만 맞는 가짜 등록 방지)
  if (input.media.length > 0) {
    const { data: signed, error: existErr } = await admin.storage
      .from(RETURN_EVIDENCE_BUCKET)
      .createSignedUrls(input.media.map((m) => m.path), 60)
    if (existErr || (signed ?? []).some((s) => !s.signedUrl || s.error)) {
      return json({ error: '올린 파일을 확인하지 못했어요. 사진을 다시 올려 주세요.' }, { status: 400 })
    }
  }

  const { data: saved, error: saveErr } = await admin
    .from('reservation_return_admin_entries')
    .insert({
      reservation_id: reservationId,
      registered_by: session.user.id,
      memo: input.memo,
      checklist: input.checklist,
      media: input.media,
    })
    .select('id')
    .single()
  if (saveErr || !saved) return json({ error: '저장하지 못했어요. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  const entryId = (saved as { id: number }).id

  // 대여중이면 반납중으로 전환 — 실패하면 방금 만든 등록을 되돌려 "등록됐는데 상태는 그대로"가 남지 않게 한다
  let nextStatus = r.status
  if (r.status === 'in_use') {
    const { data: result, error: rpcErr } = await admin.rpc('update_reservation_status', {
      p_reservation_id: reservationId,
      p_new_status: 'return_requested',
    })
    const out = result as { ok?: boolean; error?: string } | null
    if (rpcErr || !out?.ok) {
      // 롤백용 직접 삭제 — 고객 반납 제출(return-submit)과 같은 선례의 H-01 예외(방금 만든 행 1건 되돌리기, sp3 MINOR-1 승인)
      await admin.from('reservation_return_admin_entries').delete().eq('id', entryId)
      return json({ error: out?.error ?? rpcErr?.message ?? '반납 요청 처리에 실패했어요. 다시 등록해 주세요.' }, { status: 500 })
    }
    nextStatus = 'return_requested'
  }

  // 대여 액션 로그(fail-soft) — 관리자 직접 등록임을 note 로 구분
  try {
    await admin.rpc('log_rental_action', {
      p_reservation_id: reservationId,
      p_action_type: 'admin_return_entry',
      p_admin_id: session.user.id,
      p_note: 'admin_return_entry',
    })
  } catch {
    // 로그 실패는 무시
  }

  return json({ ok: true, id: entryId, status: nextStatus })
}
