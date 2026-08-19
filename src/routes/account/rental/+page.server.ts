import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export interface MyRental {
  id:                   string
  status:               string
  reservation_code:     string
  start_date:           string | null
  end_date:             string | null
  created_at:           string
  product_name:         string | null
  product_category:     string | null
  has_signed_contract:  boolean
}

export const load: PageServerLoad = async ({ locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/auth/login')

  const { data, error } = await locals.supabase
    .from('rental_reservations')
    .select('id, status, reservation_code, start_date, end_date, created_at, product_id, products(name, category)')
    .eq('user_id', session.user.id)
    .in('status', ['hold', 'confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed'])
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    return { rentals: [] as MyRental[] }
  }

  const reservationIds = (data ?? []).map((r: Record<string, unknown>) => r.id as string | number)

  // 카드에 "전자계약 확인" 버튼을 노출할지 판단 — 서명 완료된(signed_at IS NOT NULL) 계약이
  // 이 예약에 하나라도 있으면 true (재발송 등으로 계약이 여러 건일 수 있어 signed 여부만 확인)
  const signedReservationIds = new Set<string>()
  if (reservationIds.length > 0) {
    const { data: signedContracts } = await locals.supabase
      .from('contracts')
      .select('reservation_id, contract_signings!inner(signed_at)')
      .in('reservation_id', reservationIds)
      .not('contract_signings.signed_at', 'is', null)

    for (const row of signedContracts ?? []) {
      signedReservationIds.add(String((row as { reservation_id: string | number }).reservation_id))
    }
  }

  const rentals: MyRental[] = (data ?? []).map((r: Record<string, unknown>) => {
    const product = (r.products as { name: string; category: string } | null) ?? null
    return {
      id:                  r.id as string,
      status:              r.status as string,
      reservation_code:    r.reservation_code as string,
      start_date:          r.start_date as string | null,
      end_date:            r.end_date as string | null,
      created_at:          r.created_at as string,
      product_name:        product?.name ?? null,
      product_category:    product?.category ?? null,
      has_signed_contract: signedReservationIds.has(String(r.id)),
    }
  })

  return { rentals }
}
