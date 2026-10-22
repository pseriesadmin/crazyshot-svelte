import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { RETURN_EVIDENCE_BUCKET, buildEvidencePath, validateMediaFile } from '$lib/server/returnSubmission'
import { ADMIN_RETURN_FOLDER, ADMIN_RETURN_STATUSES } from '$lib/server/returnAdminEntry'

// 반납정보 관리자 직접 등록 — 사진·영상 업로드용 서명 URL 발급 (Migration #737, 2026-10-22)
// 메뉴 rental.reservation + CMS 직원. 등록 가능 상태의 예약에서만 발급하고, 경로는 {예약}/admin/{uuid}.{확장자} 로 고정한다.
export const POST: RequestHandler = async ({ params, request, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })

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
  const { data: res } = await admin.from('rental_reservations').select('status').eq('id', reservationId).maybeSingle()
  if (!res) return json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 })
  const r = res as { status: string }
  if (!ADMIN_RETURN_STATUSES.has(r.status)) return json({ error: '지금은 반납정보를 등록할 수 없는 상태입니다.' }, { status: 409 })

  const path = buildEvidencePath(reservationId, ADMIN_RETURN_FOLDER, contentType)
  const { data, error } = await admin.storage.from(RETURN_EVIDENCE_BUCKET).createSignedUploadUrl(path)
  if (error || !data) return json({ error: '업로드 준비에 실패했어요. 잠시 후 다시 시도해 주세요.' }, { status: 500 })

  return json({ path: data.path ?? path, token: data.token, kind: file.kind })
}
