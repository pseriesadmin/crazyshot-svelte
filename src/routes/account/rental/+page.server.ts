import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { loadRentalContractStatus } from '$lib/server/account/loadRentalContractStatus'
import { loadCancelKinds, loadCancelRequestedIds } from '$lib/server/cancelPolicyLoader'
import type { CancelKind } from '$lib/utils/canCancelReservation'
import { applyParentFieldsToRowProducts } from '$lib/server/products/resolveParentProductFields'

export interface MyRental {
  id:                     string
  status:                 string
  reservation_code:       string
  start_date:             string | null
  end_date:               string | null
  created_at:             string
  product_name:           string | null
  product_category:       string | null
  has_signed_contract:    boolean
  // 서명 대기 중인 계약이 있을 때만 값이 있음 — /contract/{token} 서명화면 딥링크용
  pending_contract_token: string | null
  // 고객 셀프 예약신청취소 가능 여부 (서버에서 계산)
  canCancel:              boolean
  cancelKind:             CancelKind
  cancelRequested:        boolean
  /** 고객이 취소했고 관리자 취소확인 전 — "취소중" 비활성 카드 */
  cancelling:             boolean
  tracking_number:        string | null
}

export const load: PageServerLoad = async ({ locals, url }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, `/auth/login?redirect=${encodeURIComponent(url.pathname)}`)

  const { data, error } = await locals.supabase
    .from('rental_reservations')
    .select('id, status, reservation_code, start_date, end_date, created_at:submitted_at, product_id, tracking_number, pickup_method, pickup_time, customer_cancelled_at, cancel_confirmed_at, cancel_requested_at, products!rental_reservations_product_id_fkey(name, category, parent_product_id)')
    .eq('user_id', session.user.id)
    // 취소중(고객이 취소했고 관리자 확인 전) 예약도 목록에 남긴다 — 관리자가 취소확인하면 /account/cancel로 이동
    .or('status.in.(hold,confirmed,shipped,in_use,return_requested,returned,completed),and(status.eq.cancelled,customer_cancelled_at.not.is.null,cancel_confirmed_at.is.null)')
    .order('submitted_at', { ascending: false })
    .limit(50)

  if (error) {
    return { rentals: [] as MyRental[] }
  }

  // 자식 재고의 이름·분류는 부모 값을 따른다(자식 재고 부모 참조 전환 Phase 3-B)
  await applyParentFieldsToRowProducts(data ?? [], ['name', 'category'])

  const reservationIds = (data ?? []).map((r: Record<string, unknown>) => r.id as string | number)

  // 카드에 "전자계약 확인"(서명완료) 또는 "전자계약 서명하기"(서명대기) 버튼을 노출할지 판단
  const contractStatus = await loadRentalContractStatus(locals.supabase, reservationIds)

  // 취소 판정 (2026-09-30 정책: 수령 신청 마감 전 즉시취소 / 마감 후·대여 시작 후 문의) — 같은 주문 형제 예약 포함
  const nowMs = Date.now()
  const cancelKinds = await loadCancelKinds(
    locals.supabase,
    ((data ?? []) as Array<Record<string, unknown>>).map(r => ({
      id: r.id as string | number,
      status: r.status as string,
      tracking_number: (r.tracking_number as string | null) ?? null,
      start_date: (r.start_date as string | null) ?? null,
      pickup_method: (r.pickup_method as string | null) ?? null,
    })),
    nowMs,
  )

  // 마감 후 취소 요청(②구간)이 이미 접수된 예약 — 버튼 대신 "접수됨" 표시
  const cancelRequestedIds = await loadCancelRequestedIds(locals.supabase, reservationIds)

  const rentals: MyRental[] = (data ?? []).map((r: Record<string, unknown>) => {
    const product = (r.products as { name: string; category: string } | null) ?? null
    const status = contractStatus.get(String(r.id))
    return {
      id:                     r.id as string,
      status:                 r.status as string,
      reservation_code:       r.reservation_code as string,
      start_date:             r.start_date as string | null,
      end_date:               r.end_date as string | null,
      created_at:             r.created_at as string,
      product_name:           product?.name ?? null,
      product_category:       product?.category ?? null,
      has_signed_contract:    status?.signed ?? false,
      pending_contract_token: status?.pendingToken ?? null,
      tracking_number:        r.tracking_number as string | null,
      cancelKind: cancelKinds.get(String(r.id)) ?? 'unavailable',
      cancelRequested: cancelRequestedIds.has(String(r.id)),
      cancelling: (r.status === 'cancelled' && !!r.customer_cancelled_at && !r.cancel_confirmed_at) || (r.status !== 'cancelled' && !!r.cancel_requested_at),
      canCancel: (cancelKinds.get(String(r.id)) ?? 'unavailable') === 'free',
    }
  })

  return { rentals }
}
