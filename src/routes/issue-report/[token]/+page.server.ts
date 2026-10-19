/**
 * /issue-report/[token] — 고객 이상·파손·분실 증빙 등록 폼 (3단계, Migration #728)
 * 운영자가 예약에 [이슈 사전 접수]를 누르면 채팅카드·푸시·문자로 이 링크가 고객에게 간다.
 * 로그인 없이 토큰으로만 접근(계약서 /contract/[token] 과 같은 방식). 토큰 형식·존재·기한·취소 여부를 서버가 확인한다.
 */
import { error } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { applyParentFieldsToRowProducts } from '$lib/server/products/resolveParentProductFields'
import { isIssueReportToken } from '$lib/utils/inspection'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params }) => {
  if (!isIssueReportToken(params.token)) throw error(404, '유효하지 않은 링크예요.')

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data } = await admin
    .from('reservation_issue_reports')
    .select('reservation_id, status, expires_at, issue_types, detail, submitted_at')
    .eq('token', params.token)
    .maybeSingle()
  const report = data as {
    reservation_id: number
    status: string
    expires_at: string
    issue_types: string[] | null
    detail: string | null
    submitted_at: string | null
  } | null
  if (!report) throw error(404, '유효하지 않은 링크예요.')

  const { data: res } = await admin
    .from('rental_reservations')
    .select('status, reservation_code, products!rental_reservations_product_id_fkey(name, parent_product_id)')
    .eq('id', report.reservation_id)
    .maybeSingle()
  const row = (res ?? null) as { status?: string; reservation_code?: string | null; products?: { name?: string } | { name?: string }[] | null } | null

  // 취소·만료뿐 아니라 반납 이후(검수 중·완료)에도 증빙을 바꿀 수 없다(Migration #729) — 닫힌 링크는 상품명·예약코드·이전 내용을 내려주지 않는다
  const open = ['confirmed', 'shipped', 'in_use', 'return_requested'].includes(row?.status ?? '')
  const expired = report.status === 'cancelled' || new Date(report.expires_at).getTime() < Date.now() || !open

  let productName: string | null = null
  if (row && !expired) {
    await applyParentFieldsToRowProducts([row], ['name'], admin)
    const p = row.products
    productName = (Array.isArray(p) ? p[0] : p)?.name ?? null
  }

  return {
    token: params.token,
    expired,
    productName,
    reservationCode: expired ? null : (row?.reservation_code ?? null),
    submitted: !expired && report.status === 'submitted',
    submittedAt: report.submitted_at,
    // 이전에 제출한 유형·내용은 같은 링크를 가진 본인에게만 보인다(사진은 내려보내지 않는다)
    prevTypes: expired ? [] : (report.issue_types ?? []),
    prevDetail: expired ? '' : (report.detail ?? ''),
  }
}
