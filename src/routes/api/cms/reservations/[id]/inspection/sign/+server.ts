import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { RETURN_EVIDENCE_BUCKET, buildEvidencePath, validateMediaFile } from '$lib/server/returnSubmission'

// 검수 이슈 증빙(관리자) 업로드용 서명 URL 발급 (2단계, Migration #724) — manager 이상 + 메뉴 rental.reservation.
// 고객 반납 증빙 버킷(return-evidence)을 같이 쓰되 항목 폴더는 'issue' 로 분리한다({예약}/issue/{uuid}.{확장자}).
export const POST: RequestHandler = async ({ params, request, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '검수 처리는 매니저 이상만 할 수 있습니다.' }, { status: 403 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })
  }

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

  // 반납완료 예약에만 증빙 업로드 서명을 발급한다(임의 예약 id 로 저장소를 쓰는 것 방지)
  const { data: res } = await admin.from('rental_reservations').select('status').eq('id', reservationId).maybeSingle()
  if ((res as { status?: string } | null)?.status !== 'returned') {
    return json({ error: '반납완료 상태의 예약에만 증빙을 첨부할 수 있습니다.' }, { status: 409 })
  }

  const path = buildEvidencePath(reservationId, 'issue', contentType)
  const { data, error } = await admin.storage.from(RETURN_EVIDENCE_BUCKET).createSignedUploadUrl(path)
  if (error || !data) return json({ error: '업로드 준비에 실패했어요. 잠시 후 다시 시도해 주세요.' }, { status: 500 })

  return json({ path: data.path ?? path, token: data.token, kind: file.kind })
}
