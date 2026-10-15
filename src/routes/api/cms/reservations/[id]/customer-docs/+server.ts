import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasAutoIssueTemplate } from '$lib/server/contractAutoIssue'
import { getDocGateStatus, identityRequiredMet, foreignRequiredMet, type DocGateStatus } from '$lib/utils/docApproval'

// 예약 고객의 본인증명·외국인증명 등록·승인 상태 조회(조회 전용) — RentalDetailPanel "고객정보" 탭의 서류 상태 행이 사용(2026-10-15).
// 판정은 예약 차단 게이트와 같은 docApproval.ts 규칙: none(미등록) / incomplete(필수 서류 미비) / pending(승인 대기, 승인 취소·재제출 포함) / approved(승인 완료).
// 서류 파일 URL·경로는 응답에 싣지 않는다(건수·종류·시각만).
type DocState = DocGateStatus | 'incomplete'

export const GET: RequestHandler = async ({ params, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: res } = await admin
    .from('rental_reservations').select('user_id').eq('id', reservationId).maybeSingle()
  const userId = (res as { user_id: string | null } | null)?.user_id
  if (!userId) return json({ error: '예약 정보를 찾을 수 없습니다.' }, { status: 404 })

  const { data: p, error } = await admin
    .from('user_profiles')
    .select(
      'identity_doc_url, identity_type, identity_verified_at, identity_approved_at, ' +
        'foreign_doc_url, foreign_doc_urls, foreign_type, foreign_verified_at, foreign_approved_at, is_foreign, foreign_stay_type',
    )
    .eq('id', userId)
    .maybeSingle()
  if (error) return json({ error: error.message }, { status: 500 })

  const row = (p ?? {}) as {
    identity_doc_url?: string[] | null; identity_type?: string[] | null
    identity_verified_at?: string | null; identity_approved_at?: string | null
    foreign_doc_url?: string | null; foreign_doc_urls?: string[] | null; foreign_type?: string[] | null
    foreign_verified_at?: string | null; foreign_approved_at?: string | null
    is_foreign?: boolean | null; foreign_stay_type?: string | null
  }

  const identityCount = row.identity_doc_url?.length ?? 0
  const foreignCount = row.foreign_doc_urls?.length ?? (row.foreign_doc_url ? 1 : 0)

  // 종류별 판정 — 반대쪽 서류 필드를 비운 행으로 게이트 함수를 재사용한다.
  const identityGate = getDocGateStatus({
    identity_doc_url: row.identity_doc_url, identity_type: row.identity_type,
    identity_verified_at: row.identity_verified_at, identity_approved_at: row.identity_approved_at,
  })
  const foreignGate = getDocGateStatus({
    foreign_doc_url: row.foreign_doc_url, foreign_doc_urls: row.foreign_doc_urls, foreign_type: row.foreign_type,
    foreign_verified_at: row.foreign_verified_at, foreign_approved_at: row.foreign_approved_at,
  })
  const identityState: DocState = identityCount > 0 && !identityRequiredMet(row.identity_type) ? 'incomplete' : identityGate
  const foreignState: DocState = foreignCount > 0 && !foreignRequiredMet(row.foreign_type) ? 'incomplete' : foreignGate

  // '예약승인' 버튼 상태 판정용(2026-10-15) — 자동발행 표준양식 지정 여부, 전체 서류 게이트, 24시간 안에 등록요청 카드를 보냈는지
  const autoIssueEnabled = await hasAutoIssueTemplate(admin)
  const gate = getDocGateStatus(row)
  let requestedRecently = false
  try {
    const { data: sessions } = await admin.from('chat_sessions').select('id').eq('user_id', userId)
    const sids = ((sessions ?? []) as Array<{ id: string }>).map((x) => x.id)
    if (sids.length > 0) {
      const since = new Date(Date.now() - 24 * 3600_000).toISOString()
      const { data: cards } = await admin
        .from('chat_messages').select('id')
        .in('session_id', sids)
        .eq('action_payload->>type', 'identity_request')
        .gte('created_at', since)
        .limit(1)
      requestedRecently = (cards?.length ?? 0) > 0
    }
  } catch { /* 조회 실패 — 요청 이력 없음으로 본다 */ }

  // 예약승인을 눌렀으나 서류 승인을 기다리는 예약인지(Migration #718) — 컬럼이 없는 환경이면 false
  let approveRequested = false
  try {
    const { data: m, error: mErr } = await admin
      .from('rental_reservations').select('approve_requested_at').eq('id', reservationId).maybeSingle()
    approveRequested = !mErr && !!(m as { approve_requested_at: string | null } | null)?.approve_requested_at
  } catch { /* 조회 실패 — 대기 아님으로 본다 */ }

  // 예약승인 완료 여부(approved_at, Migration #719). approvalTracking=false(컬럼이 없는 환경)면 화면이 계약서 탭을 잠그지 않는다 — 마이그레이션 미적용 상태에서 계약서를 못 보내는 일을 막는다.
  let approved = false
  let approvalTracking = true
  try {
    const { data: m2, error: m2Err } = await admin
      .from('rental_reservations').select('approved_at').eq('id', reservationId).maybeSingle()
    if (m2Err) approvalTracking = false
    else approved = !!(m2 as { approved_at: string | null } | null)?.approved_at
  } catch { approvalTracking = false }

  return json({
    autoIssueEnabled, gate, requestedRecently, approveRequested, approved, approvalTracking,
    userId,
    isForeign: !!row.is_foreign,
    // 서류 종류·시각만 내려준다(파일 URL·경로는 싣지 않는다 — 열람은 /api/cms/customers/[id]/doc-url의 서명 URL)
    identity: { state: identityState, count: identityCount, verifiedAt: row.identity_verified_at ?? null, approvedAt: row.identity_approved_at ?? null, types: row.identity_type ?? null },
    foreign: { state: foreignState, count: foreignCount, verifiedAt: row.foreign_verified_at ?? null, approvedAt: row.foreign_approved_at ?? null, types: row.foreign_type ?? null, stayType: row.foreign_stay_type ?? null },
  })
}
