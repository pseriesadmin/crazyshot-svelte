/**
 * POST /api/issue-report/[token] — 고객 이상·파손 증빙 제출 (3단계, Migration #728)
 * 로그인 없이 증빙 요청 링크(토큰)로만 접근한다. 저장은 submit_prior_issue_report RPC(열린 요청·기한 확인)가 한다.
 * 올린 파일 경로는 그 예약의 prior 폴더 경로만 인정하고, 실제로 버킷에 있는지 확인한다.
 */
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { RETURN_EVIDENCE_BUCKET, isOwnedEvidencePath } from '$lib/server/returnSubmission'
import { submitPriorIssueReport } from '$lib/server/priorIssue'
import { isIssueReportToken, validatePriorReportInput } from '$lib/utils/inspection'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ params, request }) => {
  const token = params.token
  if (!isIssueReportToken(token)) return json({ error: '유효하지 않은 링크예요.' }, { status: 404 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data } = await admin.from('reservation_issue_reports').select('reservation_id').eq('token', token).maybeSingle()
  const reservationId = (data as { reservation_id: number } | null)?.reservation_id
  if (!reservationId) return json({ error: '유효하지 않은 링크예요.' }, { status: 404 })

  const parsed = validatePriorReportInput(
    body,
    (path) => isOwnedEvidencePath(path, reservationId) && path.startsWith(`${reservationId}/prior/`),
  )
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 })

  // 올렸다고 주장하는 파일이 실제로 있는지 확인
  if (parsed.value.media.length > 0) {
    const { data: signed, error: existErr } = await admin.storage
      .from(RETURN_EVIDENCE_BUCKET)
      .createSignedUrls(parsed.value.media.map((m) => m.path), 60)
    if (existErr || (signed ?? []).some((s) => !s.signedUrl || s.error)) {
      return json({ error: '올린 파일을 확인하지 못했어요. 사진을 다시 올려 주세요.' }, { status: 400 })
    }
  }

  const result = await submitPriorIssueReport(admin, token, parsed.value)
  if (!result.ok) return json({ error: result.error ?? '제출에 실패했습니다.' }, { status: 409 })
  return json({ ok: true })
}
