/**
 * POST /api/checkout/reissue-reservation
 * hold 예약을 "재발행"한다 — 구 hold를 취소하고 동일 상품으로 새 hold를 생성한다.
 *
 * 설계 배경: promote_draft_reservation이 status='draft'만 처리하고 hold는 지원하지 않아
 * 이미 hold된 예약의 방식/날짜 변경이 불가능했다. 재발행으로 우회한다.
 *
 * 처리 순서:
 *   1. 소유권 + hold 상태 검증
 *   2. parent_product_id 조회 (RLS 클라이언트)
 *   3. reservation_options 복사
 *   4. create_hold_reservation_with_shipment (RLS — authenticated 필요)
 *   5. set_reservation_options (RLS — auth.uid() 검사 있음)
 *   6. reassign_order_item_reservation (service_role 전용 RPC)
 *   7. 구 예약 취소 (service_role)
 *   8. 성공 반환 { ok: true, newReservationId }
 */
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ locals, request }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '인증 필요' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const oldReservationId = Number(body.reservationId)
  const startDate    = String(body.startDate ?? '')
  const endDate      = String(body.endDate ?? '')
  const pickupMethod = String(body.pickupMethod ?? '')
  const returnMethod = body.returnMethod != null ? String(body.returnMethod) : null
  const pickupTime   = body.pickupTime  != null ? String(body.pickupTime)  : null
  const returnTime   = body.returnTime  != null ? String(body.returnTime)  : null
  const durationType = String(body.durationType ?? '24h')

  if (!oldReservationId || !startDate || !endDate || !pickupMethod) {
    return json({ ok: false, error: '필수 파라미터 누락' }, { status: 400 })
  }

  const admin = createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY)

  // 1. 소유권 + hold 상태 검증 (service_role로 — user_id 체크 포함)
  const { data: oldRes } = await admin
    .from('rental_reservations')
    .select('id, status, product_id')
    .eq('id', oldReservationId)
    .eq('user_id', session.user.id)
    .eq('status', 'hold')
    .maybeSingle()

  if (!oldRes) {
    return json({ ok: false, error: '재발행할 수 없는 예약입니다' }, { status: 403 })
  }

  // 2. parent_product_id 추출 — product_id(자식)의 부모를 조회
  // 장바구니 예약의 product_id는 자식(재고단위), create_hold_reservation은 부모 id를 기대
  const childProductId = (oldRes as unknown as { product_id: string }).product_id
  const { data: productRow } = await admin
    .from('products')
    .select('parent_product_id')
    .eq('id', childProductId)
    .maybeSingle()

  const parentProductId: string = ((productRow as unknown as { parent_product_id: string | null } | null)?.parent_product_id ?? childProductId) as string
  if (!parentProductId) {
    return json({ ok: false, error: '상품 정보를 가져올 수 없습니다' }, { status: 500 })
  }

  // 3. reservation_options 복사 (신규 hold에 그대로 이어붙일 용도)
  const { data: optionRows } = await admin
    .from('reservation_options')
    .select('option_product_id, option_name, qty, unit_price')
    .eq('reservation_id', oldReservationId)

  const optionsPayload = (optionRows ?? []).map((o: Record<string, unknown>) => ({
    option_product_id: o.option_product_id ?? null,
    option_name:       String(o.option_name),
    qty:               Number(o.qty),
    unit_price:        Number(o.unit_price),
  }))

  // 4. 신규 hold 생성 — RLS 클라이언트(locals.supabase)로 authenticated 경유
  // create_hold_reservation_with_shipment는 내부에서 auth.uid()를 사용하므로
  // service_role이 아닌 사용자 세션 클라이언트로 호출해야 함
  type HoldRow = { success: boolean; reservation_id: number | null; error_message: string | null }
  type RpcFn = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
  const { data: holdData, error: holdError } = await (locals.supabase.rpc as unknown as RpcFn)(
    'create_hold_reservation_with_shipment',
    {
      p_product_id:    parentProductId,
      p_start_date:    startDate,
      p_end_date:      endDate,
      p_pickup_method: pickupMethod,
      p_return_method: returnMethod,
      p_pickup_time:   pickupTime,
      p_return_time:   returnTime,
      p_duration_type: durationType,
    }
  )

  if (holdError) {
    return json({ ok: false, error: holdError.message }, { status: 500 })
  }

  const holdRow = (holdData as HoldRow[] | null)?.[0]
  if (!holdRow?.success || holdRow.reservation_id == null) {
    return json(
      { ok: false, error: holdRow?.error_message ?? '재고 확보에 실패했습니다' },
      { status: 409 }
    )
  }

  const newReservationId = holdRow.reservation_id

  // 5. reservation_options 복사 (RLS — auth.uid() 검사 있음, locals.supabase 사용)
  if (optionsPayload.length > 0) {
    await (locals.supabase.rpc as unknown as RpcFn)('set_reservation_options', {
      p_reservation_id: newReservationId,
      p_options:        optionsPayload,
    })
    // 실패해도 차단하지 않음 — 옵션 누락 경고는 클라이언트에서 처리
  }

  // 6. order_items 재연결 (service_role 전용 RPC)
  await admin.rpc('reassign_order_item_reservation', {
    p_old_reservation_id: oldReservationId,
    p_new_reservation_id: newReservationId,
  })
  // 실패해도 차단하지 않음 — order_items가 없으면 no-op

  // 7. 구 예약 취소 (service_role)
  await admin.rpc('update_reservation_status', {
    p_reservation_id: oldReservationId,
    p_new_status:     'cancelled',
  })

  return json({ ok: true, newReservationId })
}
