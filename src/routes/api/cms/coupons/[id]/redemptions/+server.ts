import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

// 쿠폰 관리 화면 "사용 채번 목록" — 실제 사용(manual/sequenced 모드 무관, used_at 기준)
// 이력을 지연 로드. 랜딩 대상은 RentalDetailPanel(/cms/reservation 또는 /cms/rentals) —
// "이 쿠폰이 결제된 정확한 예약"이 아니라 그 사용자의 가장 최근 예약(대여 정보 확인 목적,
// migration 301). user_id 기준으로 조회하므로 같은 사용자가 쿠폰을 중복 사용해도 항상
// 정확히 그 사용자로 연결된다. 예약이 하나도 없는 사용자는 reservationId/cmsPath가 null —
// 프론트에서 링크 비활성 처리.
const RENTAL_STATUSES = new Set([
  'confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed', 'damage_claimed',
])

export const GET: RequestHandler = async ({ params, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })

  const couponId = params.id
  if (!couponId) return json({ error: '잘못된 쿠폰 ID입니다.' }, { status: 400 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  type RedemptionRow = {
    user_coupon_id: string
    user_id: string
    redeemed_code: string | null
    used_at: string
    user_name: string | null
    user_email: string | null
    reservation_id: number | null
    reservation_status: string | null
  }
  const { data, error } = await admin.rpc('get_coupon_redemptions', { p_coupon_id: couponId })

  if (error) return json({ error: error.message }, { status: 500 })

  const redemptions = ((data ?? []) as RedemptionRow[]).map(r => ({
    userCouponId: r.user_coupon_id,
    userId: r.user_id,
    redeemedCode: r.redeemed_code,
    usedAt: r.used_at,
    userName: r.user_name,
    userEmail: r.user_email,
    reservationId: r.reservation_id,
    cmsPath: r.reservation_id != null
      ? (r.reservation_status && RENTAL_STATUSES.has(r.reservation_status) ? '/cms/rentals' : '/cms/reservation')
      : null,
  }))

  return json({ redemptions })
}
