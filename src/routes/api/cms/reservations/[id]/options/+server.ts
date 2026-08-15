import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

// 예약(reservation_options)에 담긴 옵션상품 조회 — 대여는 예약 정보를 그대로 관리하는
// 영역이라 RentalDetailPanel(/cms/rentals·/cms/reservation 공유)이 메인상품 외에 이 옵션도
// 함께 노출한다. option_product_id가 있는 항목만 상품코드를 조회(부모 상품이면 정책상 NULL).
export const GET: RequestHandler = async ({ params, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: rows, error } = await admin
    .from('reservation_options')
    .select('id, option_product_id, option_name, qty, unit_price')
    .eq('reservation_id', reservationId)
    .order('id', { ascending: true })

  if (error) return json({ error: error.message }, { status: 500 })

  const productIds = [...new Set(
    (rows ?? [])
      .map(r => r.option_product_id as string | null)
      .filter((v): v is string => !!v)
  )]

  let codeMap: Record<string, string | null> = {}
  if (productIds.length > 0) {
    const { data: products } = await admin
      .from('products')
      .select('id, product_code')
      .in('id', productIds)
    codeMap = Object.fromEntries(
      (products ?? []).map(p => [p.id as string, p.product_code as string | null])
    )
  }

  const options = (rows ?? []).map(r => ({
    id:           r.id as number,
    option_name:  r.option_name as string,
    qty:          r.qty as number,
    unit_price:   r.unit_price as number,
    product_code: r.option_product_id ? (codeMap[r.option_product_id as string] ?? null) : null,
  }))

  return json({ options })
}
