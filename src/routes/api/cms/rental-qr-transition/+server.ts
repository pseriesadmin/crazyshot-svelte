/**
 * /api/cms/rental-qr-transition
 * 대여목록카드 · RentalDetailPanel의 QR 자동기록 전용 — 상품 QR 일치 확인 후
 * 별도 확인 탭 없이 즉시 상태전이(반출/반납) RPC를 실행한다.
 * 로직은 /cms/mobile/qr/[product_id]의 processQrAction과 $lib/server/rentalQrTransition.ts를 공유.
 */
import { json, error } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { processRentalQrTransition } from '$lib/server/rentalQrTransition'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '인증 필요')
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) throw error(403, '권한 없음')

  const body = await request.json().catch(() => null) as
    | { reservationId?: number; newStatus?: string; productId?: string }
    | null

  const reservationId = Number(body?.reservationId)
  const newStatus = String(body?.newStatus ?? '')
  const productId = String(body?.productId ?? '')

  if (!reservationId || !newStatus) return json({ ok: false, message: '잘못된 요청' }, { status: 400 })

  const admin = createClient(getSupabaseUrl(), SUPABASE_SERVICE_ROLE_KEY)
  const result = await processRentalQrTransition(admin, {
    reservationId,
    newStatus,
    productId,
    userId: session.user.id,
  })

  return json(result, { status: result.ok ? 200 : 400 })
}
