/**
 * /api/account/rental/[id]/history
 * 고객 전용 반납 이력 CRUD — 소유권 검증 포함
 *
 * GET    → get_product_history_for_customer RPC (소유권 내장)
 * POST   → upsert_product_history_record_customer (신규, registered_by='customer')
 * PUT    → upsert_product_history_record_customer (수정, 고객 등록 이력만)
 * DELETE ?id= → delete_product_history_record_customer (고객 등록 이력만)
 *
 * 보안: 모든 메서드에서 session.user.id 검증 + RPC 내부 auth.uid() 소유권 재검증
 * Q6(확정): 고객이 이 예약(rental_reservations.user_id)의 소유자인지 서버에서 검증
 */
import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

interface HistoryImage {
  url: string
  thumb_url: string
  comment: string
  display_order: number
}

// 신규 RPC는 database.ts에 미등록 → eslint-disable로 any 허용
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

// bigint reservation id 파싱 + 검증
function parseReservationId(idStr: string): number {
  const n = parseInt(idStr, 10)
  if (isNaN(n) || n <= 0) throw error(400, '유효하지 않은 예약 ID입니다.')
  return n
}

export const GET: RequestHandler = async ({ params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '로그인이 필요합니다.')

  const reservationId = parseReservationId(params.id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: AnyClient = locals.supabase as unknown as any

  // SECURITY DEFINER RPC — auth.uid() 소유권 검증 내장
  const { data, error: rpcError } = await sb
    .rpc('get_product_history_for_customer', { p_reservation_id: reservationId })

  if (rpcError) throw error(500, (rpcError as { message: string }).message)
  return json({ records: (data as unknown[]) ?? [] })
}

export const POST: RequestHandler = async ({ request, params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '로그인이 필요합니다.')

  const reservationId = parseReservationId(params.id)

  const body = await request.json() as {
    recorded_date: string
    images: HistoryImage[]
  }

  if (!body.recorded_date) throw error(400, 'recorded_date 필수')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: AnyClient = locals.supabase as unknown as any
  // SECURITY DEFINER RPC — auth.uid() 소유권 검증 내장, registered_by='customer' 자동 설정
  const { data, error: rpcError } = await sb.rpc(
    'upsert_product_history_record_customer',
    {
      p_reservation_id: reservationId,
      p_recorded_date:  body.recorded_date,
      p_images:         body.images ?? [],
      p_id:             null,
    }
  )

  if (rpcError) throw error(500, (rpcError as { message: string }).message)
  if (!data) throw error(403, '이력 등록 권한이 없습니다.')
  return json({ id: data as string })
}

export const PUT: RequestHandler = async ({ request, params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '로그인이 필요합니다.')

  const reservationId = parseReservationId(params.id)

  const body = await request.json() as {
    id: string
    recorded_date: string
    images: HistoryImage[]
  }

  if (!body.id || !body.recorded_date) throw error(400, 'id, recorded_date 필수')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: AnyClient = locals.supabase as unknown as any
  // SECURITY DEFINER RPC — registered_by='customer' 이력만 수정 허용
  const { data, error: rpcError } = await sb.rpc(
    'upsert_product_history_record_customer',
    {
      p_reservation_id: reservationId,
      p_recorded_date:  body.recorded_date,
      p_images:         body.images ?? [],
      p_id:             body.id,
    }
  )

  if (rpcError) throw error(500, (rpcError as { message: string }).message)
  if (!data) throw error(403, '수정 권한이 없습니다. 관리자가 등록한 이력은 수정할 수 없습니다.')
  return json({ id: data as string })
}

export const DELETE: RequestHandler = async ({ url, params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '로그인이 필요합니다.')

  const reservationId = parseReservationId(params.id)
  const id = url.searchParams.get('id')
  if (!id) throw error(400, 'id 필수')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: AnyClient = locals.supabase as unknown as any
  // SECURITY DEFINER RPC — registered_by='customer' 이력만 삭제 허용
  const { data, error: rpcError } = await sb.rpc(
    'delete_product_history_record_customer',
    { p_id: id, p_reservation_id: reservationId }
  )

  if (rpcError) throw error(500, (rpcError as { message: string }).message)
  if (!data) throw error(403, '삭제 권한이 없습니다. 관리자가 등록한 이력은 삭제할 수 없습니다.')
  return json({ success: true })
}
