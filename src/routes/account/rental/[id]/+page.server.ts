// GET /account/rental/[id] — hold 예약 상세 확인 화면 (본인 소유 예약만)
// 소유권 검증 패턴: contract/+page.server.ts와 동일 — 없으면 /account/rental로 redirect
import { redirect } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { loadRentalContractStatus } from '$lib/server/account/loadRentalContractStatus'
import type { PageServerLoad } from './$types'

export interface ReservationDetail {
  id:                 string
  status:             string
  reservation_code:   string
  start_date:         string | null
  end_date:           string | null
  pickup_method:      string | null
  return_method:      string | null
  pickup_time:        string | null
  return_time:        string | null
  product_name:       string | null
  product_category:   string | null
  has_signed_contract: boolean
}

export interface ReservationOption {
  id:           string
  option_name:  string
  qty:          number
  unit_price:   number
}

export interface ReservationAmount {
  rental_fee:   number
  options_fee:  number
  deposit:      number
}

export const load: PageServerLoad = async ({ params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/auth/login')

  // 소유권 확인은 RLS 클라이언트로 — user_id 불일치 시 조회 자체가 안 됨
  const { data: raw } = await locals.supabase
    .from('rental_reservations')
    .select('id, status, reservation_code, start_date, end_date, pickup_method, return_method, pickup_time, return_time, products(name, category)')
    .eq('id', params.id)
    .eq('user_id', session.user.id)
    .maybeSingle()

  if (!raw) {
    // 없거나 타인 소유 → /account/rental로 조용히 redirect (존재 여부 비노출)
    throw redirect(303, '/account/rental')
  }

  const reservationId = Number(params.id)
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 옵션상품 조회
  const { data: optionRows } = await admin
    .from('reservation_options')
    .select('id, option_name, qty, unit_price')
    .eq('reservation_id', reservationId)
    .order('id', { ascending: true })

  // 금액 서버 정본 — rental-fee-policy.md: 클라이언트 재계산 금지, 반드시 이 RPC 경유
  const { data: amountRows } = await admin.rpc('compute_reservation_line_amount', {
    p_reservation_id: reservationId,
  })

  const typedRaw = raw as unknown as {
    id: string | number
    status: string
    reservation_code: string
    start_date: string | null
    end_date: string | null
    pickup_method: string | null
    return_method: string | null
    pickup_time: string | null
    return_time: string | null
    products: { name: string; category: string } | null
  }

  // 계약 상태 — 공용 헬퍼 재사용 (loadRentalContractStatus는 RLS 클라이언트를 기대)
  const contractStatus = await loadRentalContractStatus(locals.supabase, [typedRaw.id])
  const cs = contractStatus.get(String(typedRaw.id))

  const amountRow = Array.isArray(amountRows) && amountRows.length > 0
    ? (amountRows[0] as { rental_fee: number; options_fee: number; deposit: number })
    : null

  const reservation: ReservationDetail = {
    id:                  String(typedRaw.id),
    status:              typedRaw.status,
    reservation_code:    typedRaw.reservation_code,
    start_date:          typedRaw.start_date,
    end_date:            typedRaw.end_date,
    pickup_method:       typedRaw.pickup_method,
    return_method:       typedRaw.return_method,
    pickup_time:         typedRaw.pickup_time,
    return_time:         typedRaw.return_time,
    product_name:        typedRaw.products?.name ?? null,
    product_category:    typedRaw.products?.category ?? null,
    has_signed_contract: cs?.signed ?? false,
  }

  const options: ReservationOption[] = (optionRows ?? []).map((o: Record<string, unknown>) => ({
    id:          String(o.id),
    option_name: o.option_name as string,
    qty:         o.qty as number,
    unit_price:  o.unit_price as number,
  }))

  const amount: ReservationAmount | null = amountRow
    ? {
        rental_fee:  Number(amountRow.rental_fee),
        options_fee: Number(amountRow.options_fee),
        deposit:     Number(amountRow.deposit),
      }
    : null

  return { reservation, options, amount }
}
