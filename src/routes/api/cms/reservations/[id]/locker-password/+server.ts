/**
 * GET  /api/cms/reservations/[id]/locker-password — 무인보관함 비밀번호 조회 (CMS 전용)
 * PATCH /api/cms/reservations/[id]/locker-password — 무인보관함 비밀번호 저장 (CMS 전용)
 *
 * 물리보안 성격 데이터라 manager 이상만 조회·저장 가능(hasSettingsAccess) — tracking API에는
 * 이 등급 체크가 빠져 있던 전례가 있어(security-auth.md) 이번 신규 라우트는 반드시 포함.
 *
 * GET  : service_role로 조회 (RLS 우회 — 관리자는 모든 예약 조회 가능해야 함)
 * PATCH: locals.supabase(관리자 실세션)으로 update_reservation_locker_password RPC 호출
 *        — RPC 내부의 is_cms_user() 검증이 auth.uid() 기반이라 service_role 호출 시 거부됨
 */
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { json, error } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { isValidLockerNumber, isValidLockerPassword, LOCKER_NUMBER_ERROR, LOCKER_PASSWORD_ERROR } from '$lib/utils/lockerFields'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ params, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole || !hasSettingsAccess(cmsRole)) return json({ error: '권한이 없습니다.' }, { status: 403 })

  const reservationId = parseInt(params.id, 10)
  if (isNaN(reservationId) || reservationId <= 0) {
    return json({ error: '유효하지 않은 예약 ID입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data, error: resErr } = await admin
    .from('rental_reservations')
    .select('locker_password, locker_number')
    .eq('id', reservationId)
    .maybeSingle()

  if (resErr || !data) return json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 })

  const r = data as { locker_password: string | null; locker_number: string | null }
  return json({ locker_password: r.locker_password ?? null, locker_number: r.locker_number ?? null })
}

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '로그인이 필요합니다.')

  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole || !hasSettingsAccess(cmsRole)) throw error(403, '권한이 없습니다.')

  const reservationId = parseInt(params.id, 10)
  if (isNaN(reservationId) || reservationId <= 0) throw error(400, '유효하지 않은 예약 ID입니다.')

  const body = await request.json() as { locker_password?: string | null; locker_number?: string | null }
  const lockerPassword = (body.locker_password ?? '').trim() || null
  const lockerNumber = (body.locker_number ?? '').trim() || null

  // 무인함 번호와 비밀번호는 둘 다 입력하거나 둘 다 비워야 한다(둘 다 필수 — 둘 다 비우면 삭제)
  if ((lockerPassword === null) !== (lockerNumber === null)) {
    throw error(400, '무인함 번호와 비밀번호를 모두 입력해 주세요.')
  }
  // 무인함 번호 형식: 1~10자, 숫자·특수문자만
  if (lockerNumber !== null && !isValidLockerNumber(lockerNumber)) {
    throw error(400, LOCKER_NUMBER_ERROR)
  }

  // RSV-B-B5: 무인보관함 비밀번호 형식 검증 (4~10자, 숫자·특수문자만 — 2026-10-08 영문·한글 불가로 변경)
  if (lockerPassword !== null) {
    if (!isValidLockerPassword(lockerPassword)) {
      throw error(400, LOCKER_PASSWORD_ERROR)
    }
  }

  // locals.supabase 사용 필수 — update_reservation_locker_password RPC 내부의 is_cms_user()가
  // auth.uid() 기반이라 관리자의 실세션으로 호출해야 통과됨(update_reservation_tracking과 동일 패턴)
  const { error: rpcErr } = await (locals.supabase.rpc as unknown as (
    fn: string, args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>)('update_reservation_locker_password', {
    p_reservation_id: reservationId,
    p_password:       lockerPassword,
    p_locker_number:  lockerNumber,
  })

  if (rpcErr) {
    if (rpcErr.message.includes('not allowed for status')) {
      throw error(409, '취소·만료된 예약에는 비밀번호를 저장할 수 없습니다.')
    }
    throw error(500, '비밀번호 저장 중 오류가 발생했습니다.')
  }

  return json({ success: true, locker_password: lockerPassword, locker_number: lockerNumber })
}
