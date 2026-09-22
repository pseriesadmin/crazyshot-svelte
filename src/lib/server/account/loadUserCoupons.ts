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
  display_name: string | null
  valid_until: string | null
  min_purchase_amount: number | null
  // 2026-09-21 추가: "첫 확인일로부터 N일" 모드(relative_days) 지원
  validity_type: string | null
  valid_days: number | null
}

interface RawUserCouponRow {
  id: string
  used_at: string | null
  redeemed_code: string | null
  first_viewed_at: string | null
  coupons: RawCoupon | null
}

export async function loadUserCoupons(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<UserCouponCard[]> {
  // "coupons: 유효 쿠폰 조회" RLS(is_active·deleted_at 범위)가 비활성·삭제 쿠폰의 조인
  // 결과를 null로 감춘다 — 단, 유효기간(valid_until/relative_days) 자체는 RLS가 걸러주지
  // 않으므로 만료 여부는 아래에서 직접 계산해 제외한다(2026-09-21 — 이전 주석이 RLS가
  // 유효기간까지 걸러준다고 서술했던 건 실제 라이브 정책과 달라 정정, relative_days
  // 도입 계기로 재검증).
  const { data } = await supabase
    .from('user_coupons')
    .select('id, used_at, redeemed_code, first_viewed_at, coupons(code, discount_type, discount_value, display_name, valid_until, min_purchase_amount, validity_type, valid_days)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  const now = Date.now()

  return ((data ?? []) as unknown as RawUserCouponRow[])
    .filter(row => row.coupons !== null)
    .filter(row => {
      // relative_days 만료 제외 — first_viewed_at + valid_days가 지난 쿠폰은 목록에서 뺀다
      // (use_coupon RPC·장바구니 목록과 동일 판정, first_viewed_at이 NULL이면 카운트다운
      // 미시작 상태라 무기한 유효 취급)
      const c = row.coupons as RawCoupon
      if (c.validity_type === 'relative_days' && row.first_viewed_at && c.valid_days) {
        const expiry = new Date(row.first_viewed_at).getTime() + c.valid_days * 86400_000
        if (expiry < now) return false
      }
      return true
    })
    .map(row => {
      const c = row.coupons as RawCoupon
      const label = c.display_name
        ?? (c.discount_type === 'fixed'
          ? `${c.discount_value.toLocaleString('ko-KR')}원 할인`
          : `${c.discount_value}% 할인`)

      const status: UserCouponCard['status'] = row.used_at ? 'used' : 'usable'

      // relative_days 모드는 절대 종료일(valid_until)이 없으므로, 이미 "첫 확인"이 기록된
      // 경우(=이 화면을 여는 이 요청에서 막 마킹된 경우 포함) 실제 종료 시점을
      // first_viewed_at + valid_days로 역산해 표시한다. 아직 확인 전이면 null(카드에는
      // "상시"로 보이나, 이 함수 호출 직전에 항상 마킹을 먼저 하므로 사실상 발생하지 않음)
      const effectiveValidUntil = c.validity_type === 'relative_days'
        ? (row.first_viewed_at && c.valid_days
            ? new Date(new Date(row.first_viewed_at).getTime() + c.valid_days * 86400_000).toISOString()
            : null)
        : c.valid_until

      return {
        id: row.id,
        label,
        minPurchaseAmount: c.min_purchase_amount ?? 0,
        validUntil: effectiveValidUntil,
        status,
        statusLabel: status === 'used' ? '사용완료' : '사용가능',
        redeemedCode: row.redeemed_code,
      }
    })
}
