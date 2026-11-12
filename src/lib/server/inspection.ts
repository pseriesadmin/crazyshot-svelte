// 반납 검수 승인·이슈 등록·해소 서버 로직 (2단계, Migration #724).
// 상태 전환·판정은 DB RPC(service_role 전용)가 하고, 여기서는 그 결과에 따른 고객 알림·적립만 붙인다.
//  · 승인(pass): 대여완료 포인트 적립(rentalCompletion) + 고객 "대여 완료 안내" 카드·푸시·문자
//  · 이슈 등록: 고객 "검수 결과 안내" 카드·푸시·문자(처음 이슈로 바뀔 때만) + 관리자 푸시
//  · 해소(resolved): 대여완료 포인트만 적립, 완료 알림은 없음 — 추가청구·협의로 마감된 건(Stephen 확정 2026-10-17)
// 정시반납 적립은 returned 시점에 그대로 둔다(호출 시점을 반납 시점으로 보는 로직 — 승인 시점으로 옮기면 늦은 승인이 지각 처리됨).
import { awardReturnMissionForApproved } from '$lib/server/awardReturnRegisterMissionPoints'
import { awardRentalCompletePoints } from '$lib/server/awardRentalCompletePoints'
import { awardOnTimeReturnPoints } from '$lib/server/awardOnTimeReturnPoints'
import { recordReturnHistoryForCompleted } from '$lib/server/recordReturnHistory'
import { registerPriorIssue } from '$lib/server/priorIssue'
import { applyParentFieldsToRowProducts } from '$lib/server/products/resolveParentProductFields'
import { CUSTOMER_LIFECYCLE_PUSH_COPY, sendPushToAdmins, sendReservationLifecyclePush } from '$lib/server/push'
import type { InspectionIssueInput } from '$lib/utils/inspection'
import { issueTypeLabel } from '$lib/utils/inspection'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

export const INSPECTION_NOTICE_BUTTON_LABEL = '대여 내역 확인'
export const INSPECTION_NOTICE_URL = '/account/rental'

export type InspectionNoticeType = 'inspection_pass' | 'inspection_issue'

export interface InspectionResult {
  ok: boolean
  error?: string
}

function rpcFailMessage(error: { message?: string } | null, data: unknown, fallback: string): string {
  const fromData = (data as { error?: string } | null)?.error
  const raw = fromData ?? error?.message ?? fallback
  // DB 트리거 메시지 접두어("INSPECTION_REQUIRED: ")는 화면에 노출하지 않는다
  return raw.replace(/^INSPECTION_REQUIRED:\s*/, '')
}

/** 대여완료 포인트 적립 한 곳 — 검수 통과 시점에만 호출한다(returned 시점 호출은 제거됨). 멱등 키로 중복 지급되지 않는다. */
export async function finalizeRentalCompletion(admin: AnyClient, reservationIds: number[]): Promise<void> {
  for (const id of reservationIds) {
    try {
      await awardRentalCompletePoints(admin, id)
    } catch {
      /* 적립 실패는 완료 처리에 영향을 주지 않음(fail-soft) */
    }
  }
}

/** 검수 결과 고객 알림 — 채팅카드 → 푸시+문자(허브). 모두 fail-soft. */
export async function sendInspectionNotice(admin: AnyClient, reservationId: number, type: InspectionNoticeType): Promise<void> {
  try {
    const copy = CUSTOMER_LIFECYCLE_PUSH_COPY[type]
    if (copy) {
      // 카드 본문에는 실제 상품명이 들어가야 한다 — 자식 재고 이름은 부모 값을 따른다(없으면 일반 문구)
      let name = '상품'
      try {
        const { data } = await admin
          .from('rental_reservations')
          .select('products!rental_reservations_product_id_fkey(name, parent_product_id)')
          .eq('id', reservationId)
          .maybeSingle()
        const row = data as { products?: { name?: string } | { name?: string }[] | null } | null
        if (row) {
          await applyParentFieldsToRowProducts([row], ['name'], admin)
          const p = row.products
          const first = Array.isArray(p) ? p[0] : p
          if (first?.name) name = first.name
        }
      } catch {
        /* 상품명 조회 실패는 일반 문구로 대체 */
      }
      await admin.rpc('send_return_notice_card', {
        p_reservation_id: reservationId,
        p_notify_type: type,
        p_content: copy.body(name),
        p_button_label: INSPECTION_NOTICE_BUTTON_LABEL,
        p_action_url: INSPECTION_NOTICE_URL,
      })
    }
  } catch {
    /* 카드 실패는 푸시·문자를 막지 않는다 */
  }
  await sendReservationLifecyclePush(admin, reservationId, type)
}

/** 반납 검수 승인 — 이슈가 없는 반납완료 건을 완료로 마감한다. */
/**
 * 회수 확인 전(반납요청, return_requested) 건에서 검수 승인·이슈 등록을 바로 할 수 있게 한다(2026-10-21, Stephen 확정).
 * 같은 주문의 반납요청 상태 예약을 먼저 반납완료(returned)로 전환한다 — 전환 트리거가 검수 상태(pending/issue)를 초기화하고,
 * 정시반납 적립은 기존 returned 전환 경로와 같이 이 시점에 처리한다(fail-soft). 이미 returned 이상이면 아무것도 하지 않는다.
 */
export async function ensureReturnedForInspection(admin: AnyClient, reservationId: number): Promise<InspectionResult> {
  const { data: self } = await admin.from('rental_reservations').select('status').eq('id', reservationId).maybeSingle()
  const selfStatus = (self as { status?: string } | null)?.status
  if (!selfStatus) return { ok: false, error: '예약을 찾을 수 없습니다.' }
  if (selfStatus !== 'return_requested') return { ok: true }

  const ids: number[] = [reservationId]
  const { data: oi } = await admin.from('order_items').select('order_id').eq('reservation_id', reservationId).maybeSingle()
  const orderId = (oi as { order_id?: number | null } | null)?.order_id
  if (orderId != null) {
    const { data: sibs } = await admin.from('order_items').select('reservation_id').eq('order_id', orderId)
    const sibIds = ((sibs ?? []) as { reservation_id: number | null }[]).map((r) => r.reservation_id).filter((v): v is number => v != null && v !== reservationId)
    if (sibIds.length > 0) {
      const { data: pending } = await admin.from('rental_reservations').select('id').in('id', sibIds).eq('status', 'return_requested')
      for (const r of (pending ?? []) as { id: number }[]) ids.push(r.id)
    }
  }
  for (const id of ids) {
    const { data, error } = await admin.rpc('update_reservation_status', { p_reservation_id: id, p_new_status: 'returned' })
    const res = data as { ok?: boolean; error?: string } | null
    if (error || !res?.ok) return { ok: false, error: res?.error ?? error?.message ?? '회수 확인 처리에 실패했습니다.' }
    try {
      await awardOnTimeReturnPoints(admin, id)
    } catch {
      /* 정시반납 적립 실패는 검수 흐름에 영향 없음 */
    }
  }
  return { ok: true }
}

/**
 * 승인 대상 예약 선정 — 목록·패널은 주문 1건을 대표 예약(주문 내 최소 id) 1행으로 보여준다.
 * 대표가 이미 완료(예: 이슈 해소로 대표만 먼저 완료)됐는데 같은 주문의 다른 상품이 아직 반납완료·검수 대기이면,
 * 대표로 승인을 요청해도 DB 가 "반납완료 상태에서만" 거절해 나머지 상품을 완료할 길이 없었다(2026-11-12, 392 주문).
 * 이때만 같은 주문의 검수 대기 형제(이슈 검수중 제외) 중 가장 앞선 예약을 대신 대상으로 삼는다 — DB 승인 함수는 대상이 속한 주문의
 * 반납완료 예약을 한꺼번에 완료한다. 대표가 반납요청·반납완료이거나 고를 형제가 없으면 요청한 예약을 그대로 돌려준다(거절 사유는 DB 가 안내).
 */
export async function resolveApprovalTargetId(admin: AnyClient, reservationId: number): Promise<number> {
  const { data: self } = await admin.from('rental_reservations').select('status').eq('id', reservationId).maybeSingle()
  const selfStatus = (self as { status?: string } | null)?.status
  // 대표가 이미 '완료'일 때만 형제를 탐색한다 — 반납 전·취소·파손 등 다른 상태의 대표는 기존대로 DB 가 거절 사유를 안내한다(QA M1, 2026-11-12)
  if (selfStatus !== 'completed') return reservationId

  const { data: oi } = await admin.from('order_items').select('order_id').eq('reservation_id', reservationId).maybeSingle()
  const orderId = (oi as { order_id?: number | null } | null)?.order_id
  if (orderId == null) return reservationId
  const { data: sibs } = await admin.from('order_items').select('reservation_id').eq('order_id', orderId)
  const sibIds = ((sibs ?? []) as { reservation_id: number | null }[]).map((r) => r.reservation_id).filter((v): v is number => v != null && v !== reservationId)
  if (sibIds.length === 0) return reservationId
  const { data: pending } = await admin.from('rental_reservations').select('id, status, inspection_status').in('id', sibIds).in('status', ['returned']).order('id', { ascending: true })
  const target = ((pending ?? []) as { id: number; inspection_status?: string | null }[]).find((r) => (r.inspection_status ?? 'pending') !== 'issue')
  return target ? target.id : reservationId
}

/**
 * 반납 기록(고객 제출·관리자 대리 등록)이 없는 같은 주문 상품 id 목록 — 소급 면제(return_record_exempt) 제외 (Migration #813).
 * 조회에 실패하면 null — 호출한 쪽이 승인을 진행하지 않는다(확인 못 한 채 상태부터 바꾸는 일이 없게, fail-closed).
 */
export async function listMissingReturnRecords(admin: AnyClient, reservationId: number): Promise<number[] | null> {
  try {
    const { data, error } = await admin.rpc('return_records_missing', { p_reservation_id: reservationId })
    if (error || !Array.isArray(data)) {
      console.error('[inspection] return_records_missing 조회 실패:', error?.message ?? 'not array')
      return null
    }
    return (data as unknown[]).map((v) => Number(v)).filter((n) => Number.isInteger(n))
  } catch (e) {
    console.error('[inspection] return_records_missing 조회 예외:', e instanceof Error ? e.message : e)
    return null
  }
}

export const RETURN_RECORD_MISSING_ERROR = '반납 정보가 등록되지 않은 상품이 있어요. 모든 상품의 반납 정보를 등록한 뒤 승인해 주세요.'
export const RETURN_RECORD_CHECK_FAILED_ERROR = '반납 정보 등록 여부를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.'

export async function approveInspection(admin: AnyClient, reservationId: number, adminId: string): Promise<InspectionResult> {
  // 상품별 반납 기록 확인(2026-11-12, Stephen 지시) — 상태를 바꾸기 전에 먼저 막는다(DB 승인 함수도 같은 규칙으로 한 번 더 막는다)
  const missing = await listMissingReturnRecords(admin, reservationId)
  if (missing === null) return { ok: false, error: RETURN_RECORD_CHECK_FAILED_ERROR }
  if (missing.length > 0) return { ok: false, error: RETURN_RECORD_MISSING_ERROR }
  const targetId = await resolveApprovalTargetId(admin, reservationId)
  const ready = await ensureReturnedForInspection(admin, targetId)
  if (!ready.ok) return ready
  const { data, error } = await admin.rpc('approve_return_inspection', { p_reservation_id: targetId, p_admin_id: adminId })
  const res = data as { ok?: boolean; completed_ids?: number[] } | null
  if (error || !res?.ok) return { ok: false, error: rpcFailMessage(error, data, '검수 승인에 실패했습니다.') }
  const ids = Array.isArray(res.completed_ids) && res.completed_ids.length > 0 ? res.completed_ids : [targetId]
  await finalizeRentalCompletion(admin, ids)
  await awardReturnMissionForApproved(admin, ids) // 반납등록 미션 포인트 — 검수 승인 후 지급(등록한 예약만, 예약당 1회)
  await sendInspectionNotice(admin, targetId, 'inspection_pass')
  // 사진 복사는 오래 걸릴 수 있어 포인트·알림 뒤에 맨 마지막으로 처리한다(제한 시간에 걸려도 고객 안내·적립이 먼저 끝난다, sp3 MINOR-2). 완료 마감된 예약의 반납 등록 사진을 상품 이력에 반영(fail-soft)
  await recordReturnHistoryForCompleted(admin, ids, adminId)
  return { ok: true }
}

/** 검수 이슈 등록 — 반납완료 건을 검수 칩(issue)으로 두고 증빙·사유를 기록한다. */
export async function registerInspectionIssue(
  admin: AnyClient,
  reservationId: number,
  adminId: string,
  input: InspectionIssueInput,
): Promise<InspectionResult> {
  // 검수 이슈는 예약 상태와 무관하게 언제든 등록할 수 있다(2026-10-22, Stephen 확정 — 검수 탭 상시 노출).
  //  · 반납요청·반납완료 → 기존 검수 이슈 등록(반납완료로 전환 후 검수 칩)
  //  · 계약완료~대여중(반납 전) → 사전 접수(has_prior_issue + 고객 증빙 요청) + 이슈 기록 — 반납되면 검수 칩으로 바로 간다
  //  · 그 밖의 상태(완료·취소·신청대기 등) → 이슈 기록만 남긴다(상태·알림 변경 없음)
  const { data: stRow } = await admin.from('rental_reservations').select('status').eq('id', reservationId).maybeSingle()
  const st = (stRow as { status?: string } | null)?.status
  if (!st) return { ok: false, error: '예약을 찾을 수 없습니다.' }
  if (st !== 'returned' && st !== 'return_requested') {
    if (['confirmed', 'shipped', 'in_use'].includes(st)) {
      const prior = await registerPriorIssue(admin, reservationId, adminId)
      if (!prior.ok) return { ok: false, error: prior.error ?? '사전 접수에 실패했습니다.' }
    }
    const { error: insErr } = await admin.from('reservation_inspection_issues').insert({
      reservation_id: reservationId,
      issue_types: input.types,
      detail: input.detail || null,
      media: input.media,
      assigned_admin: adminId,
      created_by: adminId,
    })
    if (insErr) return { ok: false, error: '이슈 기록에 실패했습니다.' }
    try {
      await sendPushToAdmins('urgent_chat_message', {
        title: '검수 이슈가 등록됐어요',
        body: `${input.types.map(issueTypeLabel).join(', ')} — 확인해 주세요.`,
        link: `/cms/rentals?selected=${reservationId}`,
      })
    } catch {
      /* 관리자 푸시 실패는 무시 */
    }
    return { ok: true }
  }
  const ready = await ensureReturnedForInspection(admin, reservationId)
  if (!ready.ok) return ready
  const { data, error } = await admin.rpc('register_return_inspection_issue', {
    p_reservation_id: reservationId,
    p_admin_id: adminId,
    p_types: input.types,
    p_detail: input.detail || null,
    p_media: input.media,
  })
  const res = data as { ok?: boolean; first?: boolean } | null
  if (error || !res?.ok) return { ok: false, error: rpcFailMessage(error, data, '이슈 등록에 실패했습니다.') }

  // 처음 이슈로 바뀔 때만 고객에게 알린다(추가 이슈 기록마다 반복 발송 방지)
  if (res.first) await sendInspectionNotice(admin, reservationId, 'inspection_issue')
  try {
    await sendPushToAdmins('urgent_chat_message', {
      title: '반납 검수 이슈가 등록됐어요',
      body: `${input.types.map(issueTypeLabel).join(', ')} — 고객 협의를 진행해 주세요.`,
      link: `/cms/rentals?selected=${reservationId}`,
    })
  } catch {
    /* 관리자 푸시 실패는 무시 */
  }
  return { ok: true }
}

/** 이슈 해소 — 추가청구·협의가 끝난 건을 완료(추가청구)로 마감한다. */
export async function resolveInspectionIssue(
  admin: AnyClient,
  reservationId: number,
  adminId: string,
  note: string,
): Promise<InspectionResult> {
  const { data, error } = await admin.rpc('resolve_return_inspection_issue', {
    p_reservation_id: reservationId,
    p_admin_id: adminId,
    p_note: note || null,
  })
  const res = data as { ok?: boolean; completed_ids?: number[] } | null
  if (error || !res?.ok) return { ok: false, error: rpcFailMessage(error, data, '이슈 해소에 실패했습니다.') }
  // 이슈를 거쳐 마감된 건도 대여완료 포인트는 적립한다(멱등 키로 중복 지급 없음). 고객 알림은 보내지 않는다.
  const ids = Array.isArray(res.completed_ids) && res.completed_ids.length > 0 ? res.completed_ids : [reservationId]
  await finalizeRentalCompletion(admin, ids)
  await recordReturnHistoryForCompleted(admin, ids, adminId) // 이슈 해소로 완료 마감된 예약도 반납 등록 사진을 상품 이력에 반영(fail-soft)
  return { ok: true }
}
