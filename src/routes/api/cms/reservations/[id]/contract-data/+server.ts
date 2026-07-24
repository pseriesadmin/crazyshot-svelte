import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import type { ContractSubstitutionData } from '$lib/types/contract-module'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

const PICKUP_LABELS: Record<string, string> = {
  crazydelivery: '크레이지샷 배송',
  quick:         '당일퀵 배송',
  locker:        '무인 보관함',
  visit:         '본점 방문수령',
  epost:         '택배',
}

function formatAmount(n: number | null | undefined): string {
  if (n == null) return '-'
  return n.toLocaleString('ko-KR') + '원'
}

export const GET: RequestHandler = async ({ params, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) {
    return json({ error: '권한 없음' }, { status: 401 })
  }

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: res, error: resErr } = await admin
    .from('rental_reservations')
    .select('reservation_code, pickup_method, return_method, pickup_time, return_time, user_id, product_id')
    .eq('id', reservationId)
    .maybeSingle()

  if (resErr) return json({ error: resErr.message }, { status: 500 })
  if (!res) return json({ error: '예약 정보를 찾을 수 없습니다.' }, { status: 404 })

  const [productRes, userRes, orderItemRes, addrRes] = await Promise.all([
    admin.from('products').select('name, product_code').eq('id', res.product_id).maybeSingle(),
    admin.from('user_profiles').select('full_name, phone, email').eq('id', res.user_id).maybeSingle(),
    admin.from('order_items').select('order_id').eq('reservation_id', reservationId).maybeSingle(),
    admin.from('user_shipping_addresses')
      .select('road_address, detail_address')
      .eq('user_id', res.user_id)
      .eq('is_default', true)
      .maybeSingle(),
  ])

  let orderData: { total_amount: number | null; discount_amount: number | null; final_amount: number | null } | null = null
  if (orderItemRes.data?.order_id) {
    const { data: o } = await admin
      .from('orders')
      .select('total_amount, discount_amount, final_amount')
      .eq('id', orderItemRes.data.order_id)
      .maybeSingle()
    orderData = o
  }

  const addr = addrRes.data
  const addrStr = addr
    ? [addr.road_address, addr.detail_address].filter(Boolean).join(' ')
    : '-'

  const data: ContractSubstitutionData = {
    고객이름:     userRes.data?.full_name ?? '-',
    연락처:       userRes.data?.phone ?? '-',
    이메일:       userRes.data?.email ?? '-',
    주소:         addrStr,
    예약코드:     res.reservation_code ?? '-',
    상품코드:     productRes.data?.product_code ?? '-',
    상품명:       productRes.data?.name ?? '-',
    수량:         '1',
    수령형태:     res.pickup_method ? (PICKUP_LABELS[res.pickup_method] ?? res.pickup_method) : '-',
    수령일시:     res.pickup_time ?? '-',
    반납형태:     res.return_method ? (PICKUP_LABELS[res.return_method] ?? res.return_method) : '-',
    반납일시:     res.return_time ?? '-',
    기본대여요금: formatAmount(orderData?.total_amount),
    할인금액:     formatAmount(orderData?.discount_amount),
    부가세:       '-',
    최종합계:     formatAmount(orderData?.final_amount),
  }

  return json(data)
}
