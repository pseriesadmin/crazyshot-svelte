// GET  /api/cms/reservations/[id]/late-fees — 이 예약의 연체료 목록(미납 먼저)
// POST /api/cms/reservations/[id]/late-fees — { late_fee_id } 관리자 [결제 확인]: 결제 완료로 기록하고 고객에게 채팅카드·푸시·문자 발송
//
// 연체료는 매일 KST 00:00 자동 감지(auto_detect_late_fees)로 만들어지고, 고객 결제는 /pay/late-fee 모의결제가 처리한다.
// 현장·계좌이체 등 앱 밖 결제는 이 API(매니저 이상)로 완료 처리한다 — 처리한 관리자는 late_fees.confirmed_by 에 남는다.
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { notifyLateFeePaid } from '$lib/server/lateFeeNotify'
import { insertCmsAdminAuditLog } from '$lib/server/cmsAdminAuditLog'
import type { RequestHandler } from './$types'

interface LateFeeRow {
  id: string
  hours_late: number
  fee_amount: number
  is_paid: boolean
  paid_at: string | null
  created_at: string
  confirmed_by: string | null
}

export const GET: RequestHandler = async ({ params, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })
  // 정책 결정 2026-11-11(Stephen): 연체료 금액은 파트너 노출 불가 — 조회도 매니저 이상만(연체료 영역은 계약서 탭 안에 있어 파트너 화면에는 원래 없음)
  if (!hasSettingsAccess(cmsRole)) return json({ error: '연체료는 매니저 이상만 볼 수 있습니다.' }, { status: 403 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) return json({ error: '잘못된 예약 번호입니다.' }, { status: 400 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data, error } = await admin
    .from('late_fees')
    .select('id, hours_late, fee_amount, is_paid, paid_at, created_at, confirmed_by')
    .eq('reservation_id', reservationId)
    .order('is_paid', { ascending: true })
    .order('created_at', { ascending: false })
  if (error) {
    console.error('[cms/late-fees] 목록 조회 실패:', error.message)
    return json({ error: '연체료를 불러오지 못했습니다.' }, { status: 500 })
  }
  // 관리자 id(confirmed_by)는 내려주지 않고 "관리자가 확인했는가"만 알린다(sp5 MINOR — partner 에게 관리자 식별자 노출 방지)
  const lateFees = ((data ?? []) as LateFeeRow[]).map(({ confirmed_by, ...rest }) => ({ ...rest, confirmed_by_admin: confirmed_by != null }))
  return json({ lateFees })
}

export const POST: RequestHandler = async ({ params, locals, request }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '인증 필요' }, { status: 401 })
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })
  // 결제 확인은 금액이 걸린 처리 — 매니저 이상만
  if (!hasSettingsAccess(cmsRole)) return json({ error: '연체료 결제 확인은 매니저 이상만 할 수 있습니다.' }, { status: 403 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) return json({ error: '잘못된 예약 번호입니다.' }, { status: 400 })

  let body: { late_fee_id?: unknown }
  try {
    body = (await request.json()) as { late_fee_id?: unknown }
  } catch {
    return json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 })
  }
  const lateFeeId = typeof body.late_fee_id === 'string' ? body.late_fee_id : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lateFeeId)) {
    return json({ error: '연체료 ID가 올바르지 않습니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 이 예약의 연체료인지 확인 — 다른 예약의 연체료 ID로 확인 처리되는 것을 막는다
  const { data: own } = await admin.from('late_fees').select('id').eq('id', lateFeeId).eq('reservation_id', reservationId).maybeSingle()
  if (!own) return json({ error: '이 예약의 연체료를 찾을 수 없습니다.' }, { status: 404 })

  const { data: result, error: rpcError } = await admin.rpc('admin_confirm_late_fee_paid', {
    p_late_fee_id: lateFeeId,
    p_admin_id: session.user.id,
  })
  if (rpcError) {
    console.error('[cms/late-fees] admin_confirm_late_fee_paid 실패:', rpcError.message)
    return json({ error: '결제 확인 처리 중 오류가 발생했습니다.' }, { status: 500 })
  }
  const res = result as { ok?: boolean; error?: string; status?: number; reservation_id?: number; fee_amount?: number } | null
  if (!res?.ok) return json({ error: res?.error ?? '결제 확인에 실패했습니다.' }, { status: res?.status ?? 500 })

  // 감사로그 — 금액이 걸린 수동 결제 확인(fail-soft: 기록 실패가 이미 처리된 결제 확인을 되돌리지 않는다)
  await insertCmsAdminAuditLog(admin, {
    actorId: session.user.id,
    actionType: 'late_fee_confirm',
    targetUserId: null,
    beforeValue: { late_fee_id: lateFeeId, reservation_id: reservationId, is_paid: false },
    afterValue: { late_fee_id: lateFeeId, reservation_id: reservationId, is_paid: true, fee_amount: Number(res.fee_amount ?? 0) },
  })

  // 고객 알림 — 채팅카드 + 푸시 + 문자(fail-soft: 알림 실패가 이미 기록된 결제 확인을 되돌리지 않는다)
  await notifyLateFeePaid(admin, {
    lateFeeId,
    reservationId: res.reservation_id ?? reservationId,
    feeAmount: Number(res.fee_amount ?? 0),
  })

  return json({ ok: true })
}
