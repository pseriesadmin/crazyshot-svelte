import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

// 같은 주문(orders/order_items, Migration 251)에 속한 다른 예약(상품) 목록 조회 —
// RentalDetailPanel(/cms/rentals·/cms/reservation 공유) 결제정보 탭에서 "이 예약과 함께
// 한 번에 결제된 다른 상품"을 보여주기 위함. order_items가 없으면(단일 상품 예약) 빈 배열.
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
    .select('id, reservation_code, status, product_id, products(name)')
    .in('id', siblingIds)

  if (rowsErr) return json({ error: rowsErr.message }, { status: 500 })

  const siblings = (rows ?? []).map(r => ({
    reservationId:   r.id as number,
    reservationCode: r.reservation_code as string | null,
    status:          r.status as string,
    productName:     (r.products as unknown as { name: string } | null)?.name ?? '상품',
  }))

  return json({ siblings })
}
