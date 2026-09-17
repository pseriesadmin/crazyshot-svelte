import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { redirect, error } from '@sveltejs/kit'
import { escapeLikePattern } from '$lib/server/escapeLikePattern'
import type { PageServerLoad } from './$types'

// 예약코드 QR 스캔 착지점 — reservation_code로 예약을 찾아 해당 상품 QR 처리 화면으로 리디렉트.
// identifyQrPayload('reservation') 타입이 감지한 코드(CS…/CZ-…)만 이 경로로 들어온다.
export const load: PageServerLoad = async ({ params, parent }) => {
  const { cmsRole } = await parent()
  if (!cmsRole) throw redirect(303, '/cms/login')

  const code = decodeURIComponent(params.code).trim()
  if (!code) throw error(400, '예약코드가 없습니다.')

  const admin = createClient(getSupabaseUrl(), SUPABASE_SERVICE_ROLE_KEY)

  // ilike + escapeLikePattern: QR-CASE-1 원칙(products.md §2-7) 동일 패턴 적용.
  // reservation_code 컬럼도 대소문자 무관 정확 매칭이 필요하다.
  const { data: reservation, error: rErr } = await admin
    .from('rental_reservations')
    .select('id, product_id')
    .ilike('reservation_code', escapeLikePattern(code))
    .maybeSingle()

  if (rErr) throw error(500, '예약 조회 중 오류가 발생했습니다.')
  if (!reservation) throw error(404, `예약코드 '${code}'에 해당하는 예약을 찾을 수 없습니다.`)

  // product_id는 자식(재고 단위) UUID — /cms/mobile/qr/[product_id] load가 UUID 그대로 처리
  throw redirect(303, `/cms/mobile/qr/${reservation.product_id}`)
}
