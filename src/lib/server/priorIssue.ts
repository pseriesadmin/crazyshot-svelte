// CS 사전 이슈 접수 서버 로직 (3단계, Migration #728).
//  · registerPriorIssue: 운영자가 [이슈 사전 접수] → has_prior_issue 켜고 증빙 폼 토큰 발급 → 고객에게 증빙 요청(채팅카드+푸시+문자, 폼 링크)
//  · cancelPriorIssue: 사전 접수 해제(반납 전 예약만)
//  · submitPriorIssueReport: 고객이 폼에서 제출 → 관리자 푸시
// 해당 예약이 반납완료가 되면 DB 트리거(#724)가 자동으로 inspection_status='issue' 로 시작해 검수 칩에 [사전접수건]으로 노출된다.
import { CUSTOMER_LIFECYCLE_PUSH_COPY, sendPushToAdmins, sendReservationLifecyclePush } from '$lib/server/push'
import { applyParentFieldsToRowProducts } from '$lib/server/products/resolveParentProductFields'
import { priorKindLabel, type PriorIssueReportInput } from '$lib/utils/inspection'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

export const ISSUE_REPORT_BUTTON_LABEL = '증빙 등록'

export function issueReportPath(token: string): string {
  return `/issue-report/${token}`
}

export interface PriorIssueResult {
  ok: boolean
  error?: string
  token?: string
  reused?: boolean
}

async function productNameOf(admin: AnyClient, reservationId: number): Promise<string> {
  try {
    const { data } = await admin
      .from('rental_reservations')
      .select('products!rental_reservations_product_id_fkey(name, parent_product_id)')
      .eq('id', reservationId)
      .maybeSingle()
    const row = data as { products?: { name?: string } | { name?: string }[] | null } | null
    if (!row) return '상품'
    await applyParentFieldsToRowProducts([row], ['name'], admin)
    const p = row.products
    const first = Array.isArray(p) ? p[0] : p
    return first?.name ?? '상품'
  } catch {
    return '상품'
  }
}

/** 고객에게 증빙 폼 링크 안내 — 채팅카드(버튼=폼) → 푸시+문자(문자에는 폼 주소). 모두 fail-soft. */
export async function sendIssueReportRequest(admin: AnyClient, reservationId: number, token: string): Promise<void> {
  try {
    const name = await productNameOf(admin, reservationId)
    await admin.rpc('send_return_notice_card', {
      p_reservation_id: reservationId,
      p_notify_type: 'issue_report_request',
      p_content: CUSTOMER_LIFECYCLE_PUSH_COPY.issue_report_request.body(name),
      p_button_label: ISSUE_REPORT_BUTTON_LABEL,
      p_action_url: issueReportPath(token),
    })
  } catch {
    /* 카드 실패는 푸시·문자를 막지 않는다 */
  }
  // 같은 날 재요청도 보낼 수 있게 문자 중복 판정을 우회한다(운영자가 직접 누른 재요청)
  await sendReservationLifecyclePush(admin, reservationId, 'issue_report_request', { smsLink: issueReportPath(token), forceSms: true })
}

export async function registerPriorIssue(admin: AnyClient, reservationId: number, adminId: string): Promise<PriorIssueResult> {
  const { data, error } = await admin.rpc('register_prior_issue', { p_reservation_id: reservationId, p_admin_id: adminId })
  const res = data as { ok?: boolean; error?: string; token?: string; reused?: boolean } | null
  if (error || !res?.ok || !res.token) return { ok: false, error: res?.error ?? error?.message ?? '사전 접수에 실패했습니다.' }
  await sendIssueReportRequest(admin, reservationId, res.token)
  return { ok: true, token: res.token, reused: !!res.reused }
}

export async function cancelPriorIssue(admin: AnyClient, reservationId: number, adminId: string): Promise<PriorIssueResult> {
  const { data, error } = await admin.rpc('cancel_prior_issue', { p_reservation_id: reservationId, p_admin_id: adminId })
  const res = data as { ok?: boolean; error?: string } | null
  if (error || !res?.ok) return { ok: false, error: res?.error ?? error?.message ?? '사전 접수 해제에 실패했습니다.' }
  return { ok: true }
}

export async function submitPriorIssueReport(admin: AnyClient, token: string, input: PriorIssueReportInput): Promise<PriorIssueResult> {
  const { data, error } = await admin.rpc('submit_prior_issue_report', {
    p_token: token,
    p_types: input.types,
    p_detail: input.detail || null,
    p_media: input.media,
  })
  const res = data as { ok?: boolean; error?: string; reservation_id?: number } | null
  if (error || !res?.ok) return { ok: false, error: res?.error ?? error?.message ?? '제출에 실패했습니다.' }
  try {
    await sendPushToAdmins('urgent_chat_message', {
      title: '고객이 이상·파손 증빙을 등록했어요',
      body: `${input.types.map(priorKindLabel).join(', ')} — 검수 시 고객 자료와 실물을 비교해 주세요.`,
      link: res.reservation_id ? `/cms/rentals?selected=${res.reservation_id}` : '/cms/rentals',
    })
  } catch {
    /* 관리자 푸시 실패는 무시 */
  }
  return { ok: true }
}
