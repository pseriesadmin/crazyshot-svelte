/**
 * /account/rental/[id]/return-method — 고객 반납 방법 선택 페이지
 * window.open(_blank)으로 열리는 별도 창 — /account/rental/[id]/history와 동일 패턴
 *
 * 보안: 세션 필수 + rental_reservations.user_id 소유권 검증
 * 잠금: status가 in_use 이상이면 isLocked=true 반환 (서버측 확인)
 */
import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

// in_use 이상 = 변경 불가
const LOCKED_STATUSES = new Set([
  'in_use', 'return_requested', 'returned', 'completed', 'damage_claimed',
])

export interface RentalForReturnMethod {
  id: number
  status: string
  reservation_code: string | null
  start_date: string | null
  end_date: string | null
  return_method: string | null
  product_name: string | null
}

export const load: PageServerLoad = async ({ params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/auth/login')

  const reservationId = parseInt(params.id, 10)
  if (isNaN(reservationId) || reservationId <= 0) {
    throw redirect(303, '/account/rental')
  }

  // 예약 정보 조회 (소유권 검증 포함 — user_id 필터)
  const { data: reservation, error: resErr } = await locals.supabase
    .from('rental_reservations')
    .select('id, status, reservation_code, start_date, end_date, return_method, product_id, products(name)')
    .eq('id', reservationId)
    .eq('user_id', session.user.id)
    .maybeSingle()

  if (resErr || !reservation) {
    throw redirect(303, '/account/rental')
  }

  const r = reservation as Record<string, unknown>
  const product = (r.products as { name: string } | null) ?? null

  const rental: RentalForReturnMethod = {
    id:               r.id as number,
    status:           r.status as string,
    reservation_code: r.reservation_code as string | null,
    start_date:       r.start_date as string | null,
    end_date:         r.end_date as string | null,
    return_method:    r.return_method as string | null,
    product_name:     product?.name ?? null,
  }

  return {
    rental,
    isLocked: LOCKED_STATUSES.has(rental.status),
  }
}
