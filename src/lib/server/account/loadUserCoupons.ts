// 내정보 > 쿠폰 탭 — 관리자가 CMS(/cms/promotion/coupon)로 배포한 실제 쿠폰 목록 조회
// account/+page.server.ts(PC)와 account/profile/+page.server.ts(모바일)가 공유
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '$lib/types/database'

export interface UserCouponCard {
  id: string
  label: string
  minPurchaseAmount: number
  validUntil: string | null
  status: 'usable' | 'used'
  statusLabel: string
  // 쿠폰 지연채번(sequenced 모드)으로 실제 사용 시점에 채번된 코드 — manual 모드이거나
  // 아직 미사용이면 null(사용 전 sequenced 쿠폰은 코드 자체가 아직 존재하지 않음)
  redeemedCode: string | null
}

interface RawCoupon {
  code: string | null
  discount_type: string
  discount_value: number
  description: string | null
  valid_until: string | null
  min_purchase_amount: number | null
}

interface RawUserCouponRow {
  id: string
  used_at: string | null
  redeemed_code: string | null
  coupons: RawCoupon | null
}

export async function loadUserCoupons(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<UserCouponCard[]> {
  // "coupons: 유효 쿠폰 조회" RLS(is_active·valid_from~valid_until 범위)가 이미 만료·비활성
  // 쿠폰의 조인 결과를 null로 감추므로, 응답에 포함된 행은 항상 현재 유효기간 내 쿠폰이다.
  const { data } = await supabase
    .from('user_coupons')
    .select('id, used_at, redeemed_code, coupons(code, discount_type, discount_value, description, valid_until, min_purchase_amount)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  return ((data ?? []) as unknown as RawUserCouponRow[])
    .filter(row => row.coupons !== null)
    .map(row => {
      const c = row.coupons as RawCoupon
      const label = c.description
        ?? (c.discount_type === 'fixed'
          ? `${c.discount_value.toLocaleString('ko-KR')}원 할인`
          : `${c.discount_value}% 할인`)

      const status: UserCouponCard['status'] = row.used_at ? 'used' : 'usable'

      return {
        id: row.id,
        label,
        minPurchaseAmount: c.min_purchase_amount ?? 0,
        validUntil: c.valid_until,
        status,
        statusLabel: status === 'used' ? '사용완료' : '사용가능',
        redeemedCode: row.redeemed_code,
      }
    })
}
