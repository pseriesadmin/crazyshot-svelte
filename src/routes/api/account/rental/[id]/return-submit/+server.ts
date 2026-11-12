/**
 * POST /api/account/rental/[id]/return-submit — 고객 반납 제출(사진·체크리스트·무인함 정보) (Migration #722)
 *
 * 택배·무인함·퀵 반납 안내 알림의 [반납요청]·[무인함 반납완료]·[반납 진행중] CTA가 여는 화면의 저장 API.
 * 2026-11-12(Stephen 지시): 주문 단위·상품별 기록 필수 — 한 주문에 상품이 여러 개면 모든 상품이 각자 사진·체크(방식별 요건)를 담아 한 번에 제출해야 한다.
 *   본문 { units:[{reservation_id,checklist,media,locker_number,locker_password}], feedback, rating }(상품 1개면 옛 평면 본문도 허용) — 대상은 서버가 정한다(returnSubmitOrderUnits).
 * 저장: 상품(예약)마다 제출 1건(이미 제출한 상품은 대상에서 빠지며 재등록 불가) → 대여중(in_use)이면 반납요청(return_requested)으로 전환.
 * 전환은 update_reservation_status RPC 직접 호출이라 AUTO_NOTIFY(return_registration 카드)를 거치지 않는다 —
 * 고객이 이미 이 화면에서 반납 정보를 등록하는 중이라 "반납 정보를 등록해 달라"는 카드가 중복되지 않게 한다.
 * 보안: 세션 + 예약 소유권 + 상태·방식 + 본문 재검증(returnSubmission.ts). 저장은 서비스 롤(테이블은 RLS 정책 없음).
 * 2026-10-22(Migration #739): 고객 이용 평가(feedback, 100자·선택)·점수 저장. 미션 포인트는 제출 즉시가 아니라 관리자 검수 승인 후 지급(inspection.ts).
 */
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { RETURN_EVIDENCE_BUCKET } from '$lib/server/returnSubmission'
import { sendPushToAdmins } from '$lib/server/push'
import { registerDheroReturn } from '$lib/server/registerDheroReturn'
import { loadOrderReturnUnits, orderHasReturnFeedback, validateOrderReturnSubmit } from '$lib/server/returnSubmitOrderUnits'
import { postReturnRegisteredCard } from '$lib/server/returnRegisteredCard'
import { loadReturnInspectionItems, loadReturnPhotoItems, customerChecklistOf, customerPhotoOf } from '$lib/server/returnInspectionItems'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ request, params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) return json({ error: '유효하지 않은 예약입니다.' }, { status: 400 })

  const { data: reservation } = await locals.supabase
    .from('rental_reservations')
    .select('id')
    .eq('id', reservationId)
    .eq('user_id', session.user.id)
    .maybeSingle()
  if (!reservation) return json({ error: '이 예약에 대한 권한이 없습니다.' }, { status: 403 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류' }, { status: 500 })
  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  // 등록이 필요한 상품(같은 주문·본인·대여중/반납요청·아직 제출 없음) — 한 번 등록한 상품은 다시 등록할 수 없다(2026-10-22 Stephen 지시)
  const targets = await loadOrderReturnUnits(admin, reservationId, session.user.id)
  if (targets.length === 0) return json({ error: '지금 등록할 반납 상품이 없어요. 이미 등록했거나 등록할 수 없는 상태예요.' }, { status: 409 })

  // 체크리스트는 CMS '검수 항목 등록'의 고객검수 ON 항목 기준(마스터 조회 실패 시 기본 4종)
  const { active } = await loadReturnInspectionItems(admin)
  const photo = await loadReturnPhotoItems(admin)
  const parsed = validateOrderReturnSubmit(targets, body, customerChecklistOf(active), customerPhotoOf(photo.active))
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 })
  const units = parsed.value
  const statusById = new Map(targets.map((t) => [t.id, t.status]))
  // 같은 주문의 앞 상품이 이미 평가를 저장했다면(중간 실패 후 재제출) 평가를 다시 붙이지 않는다
  if (await orderHasReturnFeedback(admin, reservationId)) {
    for (const u of units) { u.input.feedback = null; u.input.rating = null }
  }

  // 올렸다고 주장하는 파일이 실제로 버킷에 있는지 확인(경로 형식만 맞는 가짜 제출 방지) — 모든 상품의 파일을 저장 전에 한꺼번에 확인, 없는 파일이 하나라도 있으면 거절
  const allPaths = units.flatMap((u) => u.input.media.map((m) => m.path))
  if (allPaths.length > 0) {
    const { data: signed, error: existErr } = await admin.storage.from(RETURN_EVIDENCE_BUCKET).createSignedUrls(allPaths, 60)
    if (existErr || (signed ?? []).some((s) => !s.signedUrl || s.error)) {
      return json({ error: '올린 파일을 확인하지 못했어요. 사진을 다시 올려 주세요.' }, { status: 400 })
    }
  }

  let dheroReturn: Awaited<ReturnType<typeof registerDheroReturn>> = { outcome: 'skipped' }
  const savedIds: number[] = []
  let ownedCount = 0 // 이 요청이 직접 저장·전환을 끝낸 상품 수(동시 이중 제출에서 다른 요청이 먼저 전환한 상품은 제외)

  for (const unit of units) {
    const id = unit.id
    const input = unit.input
    const mySubmittedAt = new Date().toISOString()
    // 롤백(삭제)은 이 요청이 쓴 행일 때만 — 같은 제출이 동시에 두 번 들어와 다른 요청이 같은 행을 덮어썼다면 그 요청의 제출을 지우지 않는다
    const rollbackSubmission = async (submissionId: number): Promise<void> => {
      await admin.from('reservation_return_submissions').delete().eq('id', submissionId).eq('submitted_at', mySubmittedAt)
    }
    // 최초 등록만 허용 — 같은 상품에 이미 제출 행이 있으면(동시 이중 제출) 덮어쓰지 않고 그 요청에 맡긴다(재등록 금지 규칙 유지)
    const { data: insertedRows, error: saveErr } = await admin
      .from('reservation_return_submissions')
      .upsert(
        {
          reservation_id: id,
          method: unit.method,
          checklist: input.checklist,
          locker_number: input.locker_number,
          locker_password: input.locker_password,
          customer_feedback: input.feedback,
          customer_rating: input.rating,
          submitted_by: session.user.id,
          submitted_at: mySubmittedAt,
        },
        { onConflict: 'reservation_id', ignoreDuplicates: true },
      )
      .select('id')
    if (saveErr) return json({ error: '저장하지 못했어요. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
    const saved = Array.isArray(insertedRows) ? insertedRows[0] : null
    if (!saved) {
      savedIds.push(id)
      continue // 다른 요청이 먼저 저장 중 — 사진·전환·로그·카드는 그 요청이 맡는다
    }
    const submissionId = (saved as { id: number }).id

    if (input.media.length > 0) {
      // (제출, 파일 경로) 유일 인덱스 + 중복 무시 — 같은 제출이 동시에 두 번 들어와도 사진 행이 두 번 쌓이지 않는다(Migration #816)
      const { error: mediaErr } = await admin.from('reservation_return_media').upsert(
        input.media.map((m, i) => ({
          submission_id: submissionId,
          reservation_id: id,
          item_key: m.item_key,
          storage_path: m.path,
          kind: m.kind,
          sort_order: i,
        })),
        { onConflict: 'submission_id,storage_path', ignoreDuplicates: true },
      )
      if (mediaErr) {
        await rollbackSubmission(submissionId)
        return json({ error: '사진 정보를 저장하지 못했어요. 다시 시도해 주세요.' }, { status: 500 })
      }
    }

    // 대여중이면 반납요청으로 전환(이미 반납요청이면 그대로).
    // 전환이 실패했는데 제출만 남으면 "제출 있음"으로 오인돼 안내가 끊기므로, 제출을 되돌려 이 상품부터 다시 하게 한다(이미 저장된 앞 상품은 유지 — 다시 열면 남은 상품만 나온다).
    if (statusById.get(id) === 'in_use') {
      const { data: result, error: rpcErr } = await admin.rpc('update_reservation_status', {
        p_reservation_id: id,
        p_new_status: 'return_requested',
      })
      const res = result as { ok?: boolean; error?: string } | null
      if (rpcErr || !res?.ok) {
        // 같은 제출이 동시에 두 번 들어와 다른 요청이 먼저 전환을 끝낸 경우 — 이미 반납요청이면 성공으로 보고, 그 요청이 저장한 제출을 지우지 않는다
        const { data: nowRow } = await admin.from('rental_reservations').select('status').eq('id', id).maybeSingle()
        if ((nowRow as { status?: string } | null)?.status === 'return_requested') {
          savedIds.push(id)
          continue // 다른 요청이 처리 중 — 두발히어로·로그·카드는 그 요청이 맡는다
        }
        await rollbackSubmission(submissionId)
        return json({ error: res?.error ?? rpcErr?.message ?? '반납 요청 처리에 실패했어요. 다시 제출해 주세요.' }, { status: 500 })
      }
      // 두발히어로 반품 접수(배송대여 방식·운송장 있을 때만) — updateStatus 를 거치지 않는 경로라 여기서 직접 호출한다(2026-10-23). 같은 접수번호는 형제 반품번호를 승계해 중복 접수하지 않는다.
      // 실패해도 제출은 성공(fail-soft) — 관리자 알림에 수동 등록 필요를 덧붙인다.
      const dh = await registerDheroReturn(admin, id)
      if (dh.outcome === 'failed' || dheroReturn.outcome === 'skipped') dheroReturn = dh
    }
    savedIds.push(id)
    ownedCount++

    // 대여 액션 로그 기록(플랜: customer_return_submit) — 상태는 바꾸지 않고 rental_action_logs 에만 남는다(fail-soft).
    try {
      await admin.rpc('log_rental_action', {
        p_reservation_id: id,
        p_action_type: 'customer_return_submit',
        p_admin_id: session.user.id,
        p_note: 'customer_submit',
      })
    } catch {
      // 로그 실패는 무시
    }
  }

  // 대표는 항상 주문 안에서 가장 작은 예약 번호(동시 제출에서 요청마다 달라지지 않게 — 카드가 같은 예약에 한 번만 남는다)
  const repId = units[0]?.id ?? reservationId
  // 동시 이중 제출로 모든 상품을 다른 요청이 먼저 끝냈다면 카드·관리자 푸시도 그 요청이 보낸다(중복 방지)
  if (ownedCount === 0) return json({ ok: true, registered: savedIds.length })

  // 고객 채팅 세션에 '반납등록 확인' 대화카드(고객 발신 return_submitted) — 주문당 1장(대표 상품). 관리자는 이 카드의 [반납등록 확인]으로 검수 탭을 바로 연다(2026-11-12).
  try {
    await postReturnRegisteredCard(admin, session.user.id, repId)
  } catch (e) {
    console.error('[return-submit] 반납등록 카드 기록 실패:', e instanceof Error ? e.message : e)
  }

  // 관리자에게 '반납 등록' 알림(주문당 1번) — 기존 '신규 상담' 수신 설정(new_session)을 재사용한다. 실패해도 제출은 성공 처리(fail-soft).
  try {
    const [{ data: resv }, { data: profile }] = await Promise.all([
      admin.from('rental_reservations').select('reservation_code').eq('id', repId).maybeSingle(),
      admin.from('user_profiles').select('full_name').eq('id', session.user.id).maybeSingle(),
    ])
    const code = (resv as { reservation_code?: string | null } | null)?.reservation_code ?? ''
    const name = (profile as { full_name?: string | null } | null)?.full_name ?? '고객'
    await sendPushToAdmins('new_session', {
      title: '반납 정보가 등록됐어요',
      body: `${name}님이 반납 이력정보를 등록했어요.${code ? ` (${code})` : ''}${savedIds.length > 1 ? ` 상품 ${savedIds.length}건.` : ''} 검수를 진행해 주세요.${dheroReturn.outcome === 'failed' ? ' ⚠ 두발히어로 반품 접수에 실패했어요 — 예약 상세에서 수동으로 등록해 주세요.' : ''}`,
      link: `/cms/rentals?status=returning&selected=${repId}`,
    })
  } catch {
    // 알림 실패는 제출 결과에 영향 없음
  }

  // 반납등록 미션 포인트는 제출 즉시가 아니라 관리자 검수 승인 후 지급한다(2026-10-22, approveInspection → awardReturnMissionForApproved)
  return json({ ok: true, registered: savedIds.length })
}
