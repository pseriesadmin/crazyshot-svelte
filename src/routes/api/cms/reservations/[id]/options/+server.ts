import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'

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

// ── POST: 옵션상품 추가 ────────────────────────────────────────────────────────

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '권한이 없습니다.' }, { status: 403 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })
  }

  const body = await request.json() as {
    option_product_id?: string | null
    option_name?: string
    qty?: number
    unit_price?: number
  }
  if (!body.option_name || typeof body.qty !== 'number' || typeof body.unit_price !== 'number') {
    return json({ error: 'option_name, qty, unit_price가 필요합니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data, error } = await admin.rpc('cms_add_reservation_option', {
    p_reservation_id:    reservationId,
    p_option_product_id: body.option_product_id ?? null,
    p_option_name:       body.option_name,
    p_qty:               body.qty,
    p_unit_price:        body.unit_price,
  })

  if (error) return json({ error: error.message }, { status: 500 })

  type AddOptionResult = { success: boolean; option_id: number | null; error_message: string | null }
  const result = (data as AddOptionResult[] | null)?.[0]
  if (!result) return json({ error: '응답이 없습니다.' }, { status: 500 })
  if (!result.success) return json({ error: result.error_message }, { status: 400 })

  return json({ success: true, option_id: result.option_id })
}

// ── PATCH: 옵션상품 수량 수정 ──────────────────────────────────────────────────

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '권한이 없습니다.' }, { status: 403 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })
  }

  const body = await request.json() as { option_id?: number; qty?: number }
  if (typeof body.option_id !== 'number' || !Number.isInteger(body.option_id) || body.option_id <= 0) {
    return json({ error: 'option_id가 필요합니다.' }, { status: 400 })
  }
  if (typeof body.qty !== 'number' || !Number.isInteger(body.qty) || body.qty <= 0) {
    return json({ error: 'qty는 1 이상의 정수여야 합니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data, error } = await admin.rpc('cms_update_reservation_option_qty', {
    p_option_id: body.option_id,
    p_qty:       body.qty,
  })

  if (error) return json({ error: error.message }, { status: 500 })

  type UpdateQtyResult = { success: boolean; error_message: string | null }
  const result = (data as UpdateQtyResult[] | null)?.[0]
  if (!result) return json({ error: '응답이 없습니다.' }, { status: 500 })
  if (!result.success) return json({ error: result.error_message }, { status: 400 })

  return json({ success: true })
}

// ── DELETE: 옵션상품 삭제 ──────────────────────────────────────────────────────

export const DELETE: RequestHandler = async ({ params, request, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '권한이 없습니다.' }, { status: 403 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })
  }

  const body = await request.json() as { option_id?: number }
  if (typeof body.option_id !== 'number' || !Number.isInteger(body.option_id) || body.option_id <= 0) {
    return json({ error: 'option_id가 필요합니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data, error } = await admin.rpc('cms_delete_reservation_option', {
    p_option_id: body.option_id,
  })

  if (error) return json({ error: error.message }, { status: 500 })

  type DeleteOptionResult = { success: boolean; error_message: string | null }
  const result = (data as DeleteOptionResult[] | null)?.[0]
  if (!result) return json({ error: '응답이 없습니다.' }, { status: 500 })
  if (!result.success) return json({ error: result.error_message }, { status: 400 })

  return json({ success: true })
}
