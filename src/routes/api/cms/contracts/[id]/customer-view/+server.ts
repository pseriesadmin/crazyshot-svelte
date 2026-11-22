/**
 * GET /api/cms/contracts/[id]/customer-view
 *
 * 관리자 채팅 세션에서 '전자계약서명 요청'·'전자계약완료' 카드를 눌렀을 때, 고객이 같은 버튼을 누르면
 * 보게 되는 화면("서명 완료 → 결제 이어가기")을 관리자도 볼 수 있게 해 주는 조회 전용 엔드포인트.
 * 서명은 끝났고 결제만 남은(hold·미결제) 계약에만 고객 화면 주소를 돌려준다. 그 외(결제 완료·만료·취소·미서명)는
 * payable=false — 카드는 기존 관리자 화면(예약 패널·계약 미리보기)으로 동작한다.
 *
 * 서명 링크 토큰은 고객 계약 화면의 열쇠이므로 계약서 발송과 같은 기준(manager 이상 + 예약대여현황 메뉴 권한)만 허용한다.
 * 상태를 바꾸지 않는다(읽기 전용).
 */
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { isContractPaymentPending, readReservationPayState, readSigningRef } from '$lib/utils/contractPayable'

export const GET: RequestHandler = async ({ params, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole || !hasSettingsAccess(cmsRole)) {
    return json({ error: '권한 없음' }, { status: 403 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: signing } = await admin
    .from('contract_signings')
    .select('token, signed_at, contracts!inner(reservation_id)')
    .eq('contract_id', params.id)
    .maybeSingle()

  const ref = readSigningRef(signing)
  if (!ref.token || !ref.signedAt || ref.reservationId == null) {
    return json({ payable: false, url: null })
  }

  const { data: reservation } = await admin
    .from('rental_reservations')
    .select('status, payment_confirmed_at')
    .eq('id', ref.reservationId)
    .maybeSingle()
  const rv = readReservationPayState(reservation)

  const payable = isContractPaymentPending(rv.status, rv.paymentConfirmedAt)
  return json({
    payable,
    url: payable ? `/contract/${ref.token}?adminPreview=1` : null,
  })
}
