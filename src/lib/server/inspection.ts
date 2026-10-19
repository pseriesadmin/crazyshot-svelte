// 반납 검수 승인·이슈 등록·해소 서버 로직 (2단계, Migration #724).
// 상태 전환·판정은 DB RPC(service_role 전용)가 하고, 여기서는 그 결과에 따른 고객 알림·적립만 붙인다.
//  · 승인(pass): 대여완료 포인트 적립(rentalCompletion) + 고객 "대여 완료 안내" 카드·푸시·문자
//  · 이슈 등록: 고객 "검수 결과 안내" 카드·푸시·문자(처음 이슈로 바뀔 때만) + 관리자 푸시
//  · 해소(resolved): 대여완료 포인트만 적립, 완료 알림은 없음 — 추가청구·협의로 마감된 건(Stephen 확정 2026-10-17)
// 정시반납 적립은 returned 시점에 그대로 둔다(호출 시점을 반납 시점으로 보는 로직 — 승인 시점으로 옮기면 늦은 승인이 지각 처리됨).
import { awardRentalCompletePoints } from '$lib/server/awardRentalCompletePoints'
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
export async function approveInspection(admin: AnyClient, reservationId: number, adminId: string): Promise<InspectionResult> {
  const { data, error } = await admin.rpc('approve_return_inspection', { p_reservation_id: reservationId, p_admin_id: adminId })
  const res = data as { ok?: boolean; completed_ids?: number[] } | null
  if (error || !res?.ok) return { ok: false, error: rpcFailMessage(error, data, '검수 승인에 실패했습니다.') }
  const ids = Array.isArray(res.completed_ids) && res.completed_ids.length > 0 ? res.completed_ids : [reservationId]
  await finalizeRentalCompletion(admin, ids)
  await sendInspectionNotice(admin, reservationId, 'inspection_pass')
  return { ok: true }
}

/** 검수 이슈 등록 — 반납완료 건을 검수 칩(issue)으로 두고 증빙·사유를 기록한다. */
export async function registerInspectionIssue(
  admin: AnyClient,
  reservationId: number,
  adminId: string,
  input: InspectionIssueInput,
): Promise<InspectionResult> {
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

/**
 * 이슈 담당자 지정(2026-10-19) — 방금 등록된 이슈 기록(미해소·미지정)에 담당 관리자를 기록한다.
 * 담당자는 CMS 직원(cms_role 보유)만 가능하며, 지정 실패는 이슈 등록 자체를 막지 않는다(fail-soft, 반환값 false).
 */
export async function assignInspectionIssue(admin: AnyClient, reservationId: number, adminId: string, assigneeId: string, sinceIso: string): Promise<boolean> {
  try {
    const { data: staff } = await admin.from('user_profiles').select('id').eq('id', assigneeId).not('cms_role', 'is', null).maybeSingle()
    if (!staff) return false
    // 이슈는 같은 주문의 반납완료 형제 예약마다 기록되므로 등록자·시각으로 이번 등록분을 모두 지정한다
    const { error } = await admin
      .from('reservation_inspection_issues')
      .update({ assigned_admin: assigneeId })
      .eq('created_by', adminId)
      .is('resolved_at', null)
      .is('assigned_admin', null)
      .gte('created_at', sinceIso)
    return !error
  } catch {
    return false
  }
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
  return { ok: true }
}
