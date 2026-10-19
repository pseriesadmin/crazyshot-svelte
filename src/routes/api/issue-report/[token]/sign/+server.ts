/**
 * POST /api/issue-report/[token]/sign — 고객 이상·파손 증빙 업로드용 서명 URL 발급 (3단계, Migration #728)
 * 로그인 없이 증빙 요청 링크(토큰)로만 접근한다. 열린 요청(requested/submitted, 기한 안)·반납 전 예약·토큰당 30회 이내일 때만 발급하고,
 * 경로는 그 예약 폴더의 prior 항목({예약}/prior/{uuid}.{확장자})으로 고정된다.
 */
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { RETURN_EVIDENCE_BUCKET, buildEvidencePath, validateMediaFile } from '$lib/server/returnSubmission'
import { isIssueReportToken } from '$lib/utils/inspection'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ params, request }) => {
  const token = params.token
  if (!isIssueReportToken(token)) return json({ error: '유효하지 않은 링크예요.' }, { status: 404 })

  let body: { content_type?: unknown; size?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }
  const contentType = typeof body.content_type === 'string' ? body.content_type : ''
  const size = typeof body.size === 'number' ? body.size : Number.NaN
  const file = validateMediaFile(contentType, size)
  if (!file.ok) return json({ error: file.error }, { status: 400 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  // 열린 요청·기한·예약 단계(반납 전만)·업로드 횟수(토큰당 30회)를 DB 함수가 한 번에 확인하고 횟수를 올린다(Migration #729)
  const { data: slot } = await admin.rpc('issue_report_take_upload_slot', { p_token: token })
  const res = slot as { ok?: boolean; code?: string; error?: string; reservation_id?: number } | null
  if (!res?.ok || !res.reservation_id) {
    const status = res?.code === 'not_found' ? 404 : res?.code === 'limit' ? 429 : 410
    return json({ error: res?.error ?? '유효하지 않은 링크예요.' }, { status })
  }

  const path = buildEvidencePath(res.reservation_id, 'prior', contentType)
  const { data: signed, error } = await admin.storage.from(RETURN_EVIDENCE_BUCKET).createSignedUploadUrl(path)
  if (error || !signed) return json({ error: '업로드 준비에 실패했어요. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  return json({ path: signed.path ?? path, token: signed.token, kind: file.kind })
}
