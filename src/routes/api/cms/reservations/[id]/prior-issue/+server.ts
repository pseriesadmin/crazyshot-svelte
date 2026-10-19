import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { cancelPriorIssue, registerPriorIssue } from '$lib/server/priorIssue'

// CS 사전 이슈 접수·해제 (3단계, Migration #728). manager 이상 + 메뉴 rental.reservation.
//  action: 'register'(has_prior_issue 켜기 + 고객 증빙 요청 발송, 이미 접수돼 있으면 재요청) | 'cancel'(해제)
// 접수 내용(고객 제출)은 조회 API return-evidence 가 검수 탭용으로 내려준다.
export const POST: RequestHandler = async ({ params, request, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '사전 접수는 매니저 이상만 할 수 있습니다.' }, { status: 403 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })
  }

  let body: { action?: unknown }
  try {
    body = (await request.json()) as { action?: unknown }
  } catch {
    return json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  if (body.action === 'register') {
    const r = await registerPriorIssue(admin, reservationId, session.user.id)
    if (!r.ok) return json({ error: r.error ?? '처리에 실패했습니다.' }, { status: 409 })
    return json({ ok: true, reused: !!r.reused })
  }
  if (body.action === 'cancel') {
    const r = await cancelPriorIssue(admin, reservationId, session.user.id)
    if (!r.ok) return json({ error: r.error ?? '처리에 실패했습니다.' }, { status: 409 })
    return json({ ok: true })
  }
  return json({ error: '알 수 없는 요청입니다.' }, { status: 400 })
}
