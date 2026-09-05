import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { loadRentalContractStatus } from '$lib/server/account/loadRentalContractStatus'
import { canCancelReservation } from '$lib/utils/canCancelReservation'

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
  tracking_number:        string | null
}

export const load: PageServerLoad = async ({ locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/auth/login')

  const { data, error } = await locals.supabase
    .from('rental_reservations')
    .select('id, status, reservation_code, start_date, end_date, created_at, product_id, tracking_number, pickup_method, pickup_time, products(name, category)')
    .eq('user_id', session.user.id)
    .in('status', ['hold', 'confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed'])
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    return { rentals: [] as MyRental[] }
  }

  const reservationIds = (data ?? []).map((r: Record<string, unknown>) => r.id as string | number)

  // 카드에 "전자계약 확인"(서명완료) 또는 "전자계약 서명하기"(서명대기) 버튼을 노출할지 판단
  const contractStatus = await loadRentalContractStatus(locals.supabase, reservationIds)

  // canCancel 계산: 수령방식 별 is_delivery_type 일괄 조회 (N+1 방지)
  const uniqueMethods = [...new Set(
    (data ?? [])
      .map((r: Record<string, unknown>) => r.pickup_method as string | null)
      .filter((m): m is string => !!m)
  )]

  const deliveryTypeByMethod = new Map<string, boolean>()
  if (uniqueMethods.length > 0) {
    const { data: methodOpts } = await locals.supabase
      .from('rental_method_options')
      .select('method_key, is_delivery_type')
      .in('method_key', uniqueMethods)
    for (const opt of (methodOpts ?? []) as { method_key: string; is_delivery_type: boolean | null }[]) {
      deliveryTypeByMethod.set(opt.method_key, opt.is_delivery_type === true)
    }
  }

  const nowMs = Date.now()

  const rentals: MyRental[] = (data ?? []).map((r: Record<string, unknown>) => {
    const product = (r.products as { name: string; category: string } | null) ?? null
    const status = contractStatus.get(String(r.id))
    const pickupMethod = r.pickup_method as string | null
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
      canCancel: canCancelReservation({
        status:         r.status as string,
        trackingNumber: r.tracking_number as string | null,
        isDeliveryType: pickupMethod ? (deliveryTypeByMethod.get(pickupMethod) ?? false) : false,
        startDate:      r.start_date as string | null,
        pickupTime:     r.pickup_time as string | null,
        nowMs,
      }),
    }
  })

  return { rentals }
}
