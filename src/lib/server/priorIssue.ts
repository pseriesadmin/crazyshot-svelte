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
export const ISSUE_REPORT_DONE_BUTTON_LABEL = '접수 내역 확인'

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
  const types = input.types.map(priorKindLabel).join(' · ')
  const photoCount = input.media.length
  const detailShort = (input.detail ?? '').trim().replace(/\s+/g, ' ').slice(0, 60)
  const reservationId = res.reservation_id
  const name = reservationId ? await productNameOf(admin, reservationId) : '상품'

  // 상담채팅 고객 세션에 'CS 등록완료' 대화카드 — 고객 제출을 접수했다는 확인(고객·상담 관리자 양쪽에 보이는 접수 확인 카드, §17 예외와 같은 성격 — 관리자 전용 정보 없음)
  if (reservationId) {
    try {
      await admin.rpc('send_return_notice_card', {
        p_reservation_id: reservationId,
        p_notify_type: 'issue_report_submitted',
        p_content: `CS 등록완료 — ${name}\n접수 유형: ${types}${photoCount > 0 ? `\n첨부: 사진·영상 ${photoCount}건` : ''}${detailShort ? `\n내용: ${detailShort}` : ''}\n담당자가 확인한 뒤 안내드릴게요.`,
        p_button_label: ISSUE_REPORT_DONE_BUTTON_LABEL,
        p_action_url: '/account/rental',
      })
    } catch {
      /* 카드 실패는 접수 결과에 영향 없음 */
    }
  }

  // 관리자 푸시 — 고객·상품·유형·첨부·내용 요약을 담아 검수 탭을 열지 않고도 접수 내용을 알 수 있게 한다
  try {
    let who = '고객'
    let code = ''
    if (reservationId) {
      const { data: rr } = await admin.from('rental_reservations').select('reservation_code, user_id').eq('id', reservationId).maybeSingle()
      const row = rr as { reservation_code?: string | null; user_id?: string | null } | null
      code = row?.reservation_code ?? ''
      if (row?.user_id) {
        const { data: prof } = await admin.from('user_profiles').select('full_name').eq('id', row.user_id).maybeSingle()
        who = (prof as { full_name?: string | null } | null)?.full_name?.trim() || '고객'
      }
    }
    await sendPushToAdmins('urgent_chat_message', {
      title: `CS 접수 등록 완료 — ${who}님`,
      body: `${name}${code ? ` (${code})` : ''} · ${types}${photoCount > 0 ? ` · 첨부 ${photoCount}건` : ''}${detailShort ? ` · "${detailShort}"` : ''} — 검수 시 고객 자료와 실물을 비교해 주세요.`,
      link: reservationId ? `/cms/rentals?selected=${reservationId}` : '/cms/rentals',
    })
  } catch {
    /* 관리자 푸시 실패는 무시 */
  }
  return { ok: true }
}
