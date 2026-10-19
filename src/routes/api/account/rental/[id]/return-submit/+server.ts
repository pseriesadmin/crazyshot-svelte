/**
 * POST /api/account/rental/[id]/return-submit — 고객 반납 제출(사진·체크리스트·무인함 정보) (Migration #722)
 *
 * 택배·무인함·퀵 반납 안내 알림의 [반납요청]·[무인함 반납완료]·[반납 진행중] CTA가 여는 화면의 저장 API.
 * 저장: 예약당 최신 1건(재제출 시 이전 사진은 교체) → 대여중(in_use)이면 반납요청(return_requested)으로 전환.
 * 전환은 update_reservation_status RPC 직접 호출이라 AUTO_NOTIFY(return_registration 카드)를 거치지 않는다 —
 * 고객이 이미 이 화면에서 반납 정보를 등록하는 중이라 "반납 정보를 등록해 달라"는 카드가 중복되지 않게 한다.
 * 보안: 세션 + 예약 소유권 + 상태·방식 + 본문 재검증(returnSubmission.ts). 저장은 서비스 롤(테이블은 RLS 정책 없음).
 */
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import {
  RETURN_EVIDENCE_BUCKET,
  RETURN_SUBMIT_STATUSES,
  toReturnSubmitMethod,
  validateReturnSubmit,
} from '$lib/server/returnSubmission'
import { sendPushToAdmins } from '$lib/server/push'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ request, params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) return json({ error: '유효하지 않은 예약입니다.' }, { status: 400 })

  const { data: reservation } = await locals.supabase
    .from('rental_reservations')
    .select('id, status, return_method')
    .eq('id', reservationId)
    .eq('user_id', session.user.id)
    .maybeSingle()
  if (!reservation) return json({ error: '이 예약에 대한 권한이 없습니다.' }, { status: 403 })

  const row = reservation as { status: string; return_method: string | null }
  if (!RETURN_SUBMIT_STATUSES.has(row.status)) return json({ error: '지금은 반납 정보를 등록할 수 없는 상태예요.' }, { status: 409 })
  const method = toReturnSubmitMethod(row.return_method)
  if (!method) return json({ error: '이 반납 방식은 사진 등록이 필요하지 않아요.' }, { status: 400 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }
  const parsed = validateReturnSubmit(method, reservationId, body)
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 })
  const input = parsed.value

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류' }, { status: 500 })
  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  // 올렸다고 주장하는 파일이 실제로 버킷에 있는지 확인(경로 형식만 맞는 가짜 제출 방지) — 없는 파일이 하나라도 있으면 거절
  if (input.media.length > 0) {
    const { data: signed, error: existErr } = await admin.storage
      .from(RETURN_EVIDENCE_BUCKET)
      .createSignedUrls(input.media.map((m) => m.path), 60)
    if (existErr || (signed ?? []).some((s) => !s.signedUrl || s.error)) {
      return json({ error: '올린 파일을 확인하지 못했어요. 사진을 다시 올려 주세요.' }, { status: 400 })
    }
  }

  // 이전 제출의 사진(교체 시 새 사진 저장이 성공한 뒤에만 지운다 — 실패해도 기존 제출이 비지 않게)
  const { data: prev } = await admin
    .from('reservation_return_submissions')
    .select('id')
    .eq('reservation_id', reservationId)
    .maybeSingle()
  const prevId = (prev as { id: number } | null)?.id
  let prevMediaRows: { id: number; storage_path: string }[] = []
  if (prevId) {
    const { data: prevMedia } = await admin.from('reservation_return_media').select('id, storage_path').eq('submission_id', prevId)
    prevMediaRows = (prevMedia ?? []) as { id: number; storage_path: string }[]
  }

  const { data: saved, error: saveErr } = await admin
    .from('reservation_return_submissions')
    .upsert(
      {
        reservation_id: reservationId,
        method,
        checklist: input.checklist,
        locker_number: input.locker_number,
        locker_password: input.locker_password,
        submitted_by: session.user.id,
        submitted_at: new Date().toISOString(),
      },
      { onConflict: 'reservation_id' },
    )
    .select('id')
    .single()
  if (saveErr || !saved) return json({ error: '저장하지 못했어요. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  const submissionId = (saved as { id: number }).id

  // 사진 교체 — 새 행을 먼저 삽입(순서 = 올린 순서)하고, 성공하면 이전 행을 지운다.
  // 새 행 삽입이 실패하면 이전 사진은 그대로 남는다(첫 제출이면 방금 만든 제출 행도 되돌린다).
  const keepPaths = new Set(input.media.map((m) => m.path))
  if (input.media.length > 0) {
    const { error: mediaErr } = await admin.from('reservation_return_media').insert(
      input.media.map((m, i) => ({
        submission_id: submissionId,
        reservation_id: reservationId,
        item_key: m.item_key,
        storage_path: m.path,
        kind: m.kind,
        sort_order: i,
      })),
    )
    if (mediaErr) {
      if (!prevId) await admin.from('reservation_return_submissions').delete().eq('id', submissionId)
      return json({ error: '사진 정보를 저장하지 못했어요. 다시 시도해 주세요.' }, { status: 500 })
    }
  }
  const oldIds = prevMediaRows.map((m) => m.id)
  if (oldIds.length > 0) await admin.from('reservation_return_media').delete().in('id', oldIds)

  // 대여중이면 반납요청으로 전환(이미 반납요청이면 재제출이므로 그대로).
  // 전환이 실패했는데 제출만 남으면 "제출 있음"으로 오인돼 안내가 끊기므로, 첫 제출이면 제출을 되돌려 처음부터 다시 하게 한다.
  if (row.status === 'in_use') {
    const { data: result, error: rpcErr } = await admin.rpc('update_reservation_status', {
      p_reservation_id: reservationId,
      p_new_status: 'return_requested',
    })
    const res = result as { ok?: boolean; error?: string } | null
    if (rpcErr || !res?.ok) {
      if (!prevId) await admin.from('reservation_return_submissions').delete().eq('id', submissionId)
      return json({ error: res?.error ?? rpcErr?.message ?? '반납 요청 처리에 실패했어요. 다시 제출해 주세요.' }, { status: 500 })
    }
  }

  // 대여 액션 로그 기록(플랜: customer_return_submit) — action_type 이 알려진 전환 값이 아니라 상태는 바꾸지 않고 rental_action_logs 에만 남는다.
  // 고객 제출임을 note 로 구분(운영자 경로는 qr_scan/manual). 실패해도 제출은 성공(fail-soft).
  try {
    await admin.rpc('log_rental_action', {
      p_reservation_id: reservationId,
      p_action_type: 'customer_return_submit',
      p_admin_id: session.user.id,
      p_note: prevId ? 'customer_resubmit' : 'customer_submit',
    })
  } catch {
    // 로그 실패는 무시
  }

  // 더 이상 쓰지 않는 이전 파일 정리(fail-soft — 실패해도 제출은 성공)
  const stale = prevMediaRows.map((m) => m.storage_path).filter((p) => !keepPaths.has(p))
  if (stale.length > 0) {
    try {
      await admin.storage.from(RETURN_EVIDENCE_BUCKET).remove(stale)
    } catch {
      // 정리 실패는 무시
    }
  }

  // 관리자에게 '반납 등록' 알림 — 고객이 반납 이력정보를 등록(재제출 포함)하면 CMS 직원에게 푸시한다(2026-10-19).
  // 별도 수신 설정 없이 기존 '신규 상담' 수신 설정(new_session)을 재사용한다. 실패해도 제출은 성공 처리(fail-soft).
  try {
    const [{ data: resv }, { data: profile }] = await Promise.all([
      admin.from('rental_reservations').select('reservation_code').eq('id', reservationId).maybeSingle(),
      admin.from('user_profiles').select('full_name').eq('id', session.user.id).maybeSingle(),
    ])
    const code = (resv as { reservation_code?: string | null } | null)?.reservation_code ?? ''
    const name = (profile as { full_name?: string | null } | null)?.full_name ?? '고객'
    await sendPushToAdmins('new_session', {
      title: '반납 정보가 등록됐어요',
      body: `${name}님이 반납 이력정보를 등록했어요.${code ? ` (${code})` : ''} 검수를 진행해 주세요.`,
      link: `/cms/rentals?status=returning&selected=${reservationId}`,
    })
  } catch {
    // 알림 실패는 제출 결과에 영향 없음
  }

  return json({ ok: true })
}
