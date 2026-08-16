import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

// 같은 주문(orders/order_items, Migration 280)에 속한 다른 예약(상품)의 "대여정보" 탭 표시용
// 상세 필드 조회 — RentalDetailPanel(/cms/rentals·/cms/reservation 공유) 대여정보 탭 "상품 정보"
// 섹션에서 장바구니에 함께 담긴 상품 전부를 반복 표시하기 위함. 결제정보 탭 전용 order-siblings와
// 필드 요구량·캐시 조건이 달라 별도 엔드포인트로 분리(상품명만 필요한 결제정보 탭과 섞으면
// 유지보수가 꼬임). order_items가 없으면(단일 상품 예약) 빈 배열.
export const GET: RequestHandler = async ({ params, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: ownItem, error: ownErr } = await admin
    .from('order_items')
    .select('order_id')
    .eq('reservation_id', reservationId)
    .maybeSingle()

  if (ownErr) return json({ error: ownErr.message }, { status: 500 })
  if (!ownItem) return json({ siblings: [] })

  const { data: siblingItems, error: siblingErr } = await admin
    .from('order_items')
    .select('reservation_id')
    .eq('order_id', ownItem.order_id)
    .neq('reservation_id', reservationId)

  if (siblingErr) return json({ error: siblingErr.message }, { status: 500 })

  const siblingIds = (siblingItems ?? [])
    .map(r => r.reservation_id as number | null)
    .filter((v): v is number => v != null)

  if (siblingIds.length === 0) return json({ siblings: [] })

  const { data: rows, error: rowsErr } = await admin
    .from('rental_reservations')
    .select(`
      id, reservation_code, status, start_date, end_date, pickup_method, return_method,
      products(name, product_code, category, image_urls)
    `)
    .in('id', siblingIds)

  if (rowsErr) return json({ error: rowsErr.message }, { status: 500 })

  const siblings = (rows ?? []).map(r => {
    const product = r.products as unknown as {
      name: string
      product_code: string | null
      category: string | null
      image_urls: string[] | null
    } | null
    return {
      reservationId:     r.id as number,
      reservationCode:   r.reservation_code as string | null,
      status:            r.status as string,
      rentalStart:       r.start_date as string | null,
      rentalEnd:         r.end_date as string | null,
      pickupMethod:      r.pickup_method as string | null,
      returnMethod:      r.return_method as string | null,
      productName:       product?.name ?? '상품',
      productCode:       product?.product_code ?? null,
      productCategory:   product?.category ?? null,
      productImageUrl:   product?.image_urls?.[0] ?? null,
    }
  })

  return json({ siblings })
}
