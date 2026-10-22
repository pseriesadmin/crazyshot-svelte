import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { approveInspection, registerInspectionIssue, resolveInspectionIssue } from '$lib/server/inspection'
import { isOwnedEvidencePath } from '$lib/server/returnSubmission'
import { INSPECTION_NOTE_MAX, validateIssueInput } from '$lib/utils/inspection'

// 반납 검수 승인·이슈 등록·이슈 해소 (2단계, Migration #724). manager 이상 + 메뉴 rental.reservation.
//  action: 'approve' | 'issue' | 'resolve'
// 검수 없이 returned→completed 로 가는 다른 경로(updateStatus·QR)는 막혀 있고 DB 트리거도 같은 규칙을 집행한다.
export const POST: RequestHandler = async ({ params, request, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '검수 처리는 매니저 이상만 할 수 있습니다.' }, { status: 403 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const adminId = session.user.id
  const action = body.action

  let result: { ok: boolean; error?: string }
  if (action === 'approve') {
    result = await approveInspection(admin, reservationId, adminId)
  } else if (action === 'issue') {
    const parsed = validateIssueInput(
      body,
      (path) => isOwnedEvidencePath(path, reservationId) && path.startsWith(`${reservationId}/issue/`),
    )
    if (!parsed.ok) return json({ error: parsed.error }, { status: 400 })
    result = await registerInspectionIssue(admin, reservationId, adminId, parsed.value)
  } else if (action === 'resolve') {
    const note = typeof body.note === 'string' ? body.note.trim() : ''
    if (note.length > INSPECTION_NOTE_MAX) return json({ error: `메모는 ${INSPECTION_NOTE_MAX}자 이하로 입력해 주세요.` }, { status: 400 })
    result = await resolveInspectionIssue(admin, reservationId, adminId, note)
  } else {
    return json({ error: '알 수 없는 요청입니다.' }, { status: 400 })
  }

  if (!result.ok) return json({ error: result.error ?? '처리에 실패했습니다.' }, { status: 409 })

  // 승인자·시각은 DB가 기록한다(rental_reservations.inspected_by/at, 이슈 기록 created_by/resolved_by) — 감사로그 테이블은 계정 변경 전용이라 쓰지 않는다.
  return json({ ok: true })
}
