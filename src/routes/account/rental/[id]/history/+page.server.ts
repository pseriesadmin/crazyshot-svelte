/**
 * /account/rental/[id]/history — 고객 반납 이력 등록 페이지
 * Q3 확정: window.open(_blank)으로 열리는 별도 창 — 기존 로그인 세션 재사용
 */
import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export interface RentalForHistory {
  id: number
  status: string
  reservation_code: string | null
  start_date: string | null
  end_date: string | null
  product_id: string
  product_name: string | null
  product_category: string | null
}

export interface CustomerHistoryRecord {
  id: string
  product_id: string
  recorded_date: string
  images: CustomerHistoryImage[]
  registered_by: string | null
  created_at: string
  updated_at: string
}

export interface CustomerHistoryImage {
  url: string
  thumb_url: string
  comment: string
  display_order: number
}

// 신규 RPC는 database.ts에 미등록 → eslint-disable로 any 허용
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

export const load: PageServerLoad = async ({ params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/auth/login')

  const reservationId = parseInt(params.id, 10)
  if (isNaN(reservationId) || reservationId <= 0) {
    throw redirect(303, '/account/rental')
  }

  // 예약 정보 + 상품명 조회 (소유권 검증 포함)
  const { data: reservation, error: resErr } = await locals.supabase
    .from('rental_reservations')
    .select('id, status, reservation_code, start_date, end_date, product_id, products(name, category)')
    .eq('id', reservationId)
    .eq('user_id', session.user.id)
    .maybeSingle()

  if (resErr || !reservation) {
    throw redirect(303, '/account/rental')
  }

  const r = reservation as Record<string, unknown>
  const product = (r.products as { name: string; category: string } | null) ?? null

  const rental: RentalForHistory = {
    id:               r.id as number,
    status:           r.status as string,
    reservation_code: r.reservation_code as string | null,
    start_date:       r.start_date as string | null,
    end_date:         r.end_date as string | null,
    product_id:       r.product_id as string,
    product_name:     product?.name ?? null,
    product_category: product?.category ?? null,
  }

  // 이력 초기 로드 (SECURITY DEFINER RPC — auth.uid() 소유권 재검증 내장)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: AnyClient = locals.supabase as unknown as any
  const { data: historyData, error: historyError } = await sb
    .rpc('get_product_history_for_customer', { p_reservation_id: reservationId })
  if (historyError) {
    console.error('[rental/history] get_product_history_for_customer 실패:', historyError.message)
  }

  const history: CustomerHistoryRecord[] = ((historyData as unknown[]) ?? []).map(
    (h: unknown) => {
      const row = h as Record<string, unknown>
      return {
        id:            row.id as string,
        product_id:    row.product_id as string,
        recorded_date: row.recorded_date as string,
        images:        (row.images as CustomerHistoryImage[]) ?? [],
        registered_by: row.registered_by as string | null,
        created_at:    row.created_at as string,
        updated_at:    row.updated_at as string,
      }
    }
  )

  return { rental, history }
}
