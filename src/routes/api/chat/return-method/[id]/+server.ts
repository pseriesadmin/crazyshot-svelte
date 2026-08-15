/**
 * GET /api/chat/return-method/[id] — 현재 반납 방법 + 예약 상태 조회
 * PUT /api/chat/return-method/[id] — 반납 방법 변경 (in_use 진입 전에만 허용)
 *
 * 보안:
 *  - 로그인 필수 (session 검증)
 *  - 소유권 검증 (rental_reservations.user_id === session.user.id)
 *  - status가 in_use 이상이면 PUT 차단 (서버측 강제)
 *
 * set_reservation_shipment_method(5-arg) 재사용 — auth.uid()=user_id 내부 검증도 있으나,
 * 상태(status) 체크는 애플리케이션 레벨에서 수행한다(RPC 자체는 status 제한 없음).
 */
import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

// in_use 이상 상태 = 반납방법 변경 차단
const LOCKED_STATUSES = new Set([
  'in_use', 'return_requested', 'returned', 'completed', 'damage_claimed',
])

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

function parseReservationId(idStr: string): number {
  const n = parseInt(idStr, 10)
  if (isNaN(n) || n <= 0) throw error(400, '유효하지 않은 예약 ID입니다.')
  return n
}

export const GET: RequestHandler = async ({ params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '로그인이 필요합니다.')

  const reservationId = parseReservationId(params.id)

  const { data: res, error: resErr } = await locals.supabase
    .from('rental_reservations')
    .select('status, return_method, user_id')
    .eq('id', reservationId)
    .maybeSingle()

  if (resErr || !res) throw error(404, '예약을 찾을 수 없습니다.')

  const r = res as { status: string; return_method: string | null; user_id: string }
  if (r.user_id !== session.user.id) throw error(403, '접근 권한이 없습니다.')

  return json({
    status: r.status,
    return_method: r.return_method ?? null,
    is_locked: LOCKED_STATUSES.has(r.status),
  })
}

export const PUT: RequestHandler = async ({ request, params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw error(401, '로그인이 필요합니다.')

  const reservationId = parseReservationId(params.id)

  const body = await request.json() as { return_method: string }
  const newReturnMethod = (body.return_method ?? '').trim()
  if (!newReturnMethod) throw error(400, '반납 방법을 선택해주세요.')

  // 소유권 검증 + 현재 상태·수령방법·시간 조회 (한 번에) — pickup_time/return_time도 반드시
  // 함께 읽어와야 함: 아래 RPC는 이 두 필드를 COALESCE 없이 그대로 덮어쓰므로, null을 넘기면
  // 기존에 저장된 수령/반납 희망시간이 조용히 지워진다.
  const { data: res, error: resErr } = await locals.supabase
    .from('rental_reservations')
    .select('status, pickup_method, pickup_time, return_time, user_id')
    .eq('id', reservationId)
    .maybeSingle()

  if (resErr || !res) throw error(404, '예약을 찾을 수 없습니다.')

  const r = res as {
    status: string
    pickup_method: string | null
    pickup_time: string | null
    return_time: string | null
    user_id: string
  }
  if (r.user_id !== session.user.id) throw error(403, '접근 권한이 없습니다.')

  if (LOCKED_STATUSES.has(r.status)) {
    throw error(409, '이미 대여가 진행 중이어서 반납 방법을 변경할 수 없습니다.')
  }

  // set_reservation_shipment_method — 오버로드 2개 존재(products.md §2-3와 동일한 PostgREST
  // 모호성 함정): 3-arg(migration 171)는 status='hold'일 때만 동작(그 외 상태는 0행 갱신 후
  // 에러 없이 조용히 무시됨), 5-arg(migration 147)는 상태 제약이 없어 우리가 원하는 동작과
  // 일치한다. p_reservation_id/p_pickup_method/p_return_method 3개만 넘기면 5-arg 쪽의 나머지
  // 2개 파라미터가 전부 DEFAULT NULL이라 두 오버로드 모두와 매칭되어 PGRST203 모호성 에러가 남 —
  // 반드시 5개 인자 전부 명시해 5-arg 오버로드로 명확히 고정한다.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: AnyClient = locals.supabase as unknown as any
  const { error: rpcErr } = await sb.rpc('set_reservation_shipment_method', {
    p_reservation_id: reservationId,
    p_pickup_method:  r.pickup_method ?? 'visit',
    p_return_method:  newReturnMethod,
    p_pickup_time:    r.pickup_time,
    p_return_time:    r.return_time,
  })

  if (rpcErr) {
    throw error(500, '반납 방법 저장 중 오류가 발생했습니다.')
  }

  return json({ success: true, return_method: newReturnMethod })
}
