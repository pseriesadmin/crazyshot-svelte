// GET /api/cms/customers/[id]/coupons — 고객 확인용 쿠폰함 화면(CouponTabContent.svelte)에
// 필요한 데이터를 관리자 채팅 CTA 모달에서 그대로 재사용하기 위한 단건 조회.
//
// $lib/server/account/loadUserCoupons.ts와 동일한 응답 shape(UserCouponCard[])을 만들지만,
// 그 함수는 세션 스코프 클라이언트로 호출돼 "coupons: 유효 쿠폰 조회" RLS 정책(is_active·
// deleted_at 범위)에 필터링을 위임한다 — 여기는 service-role 클라이언트라 RLS가 적용되지
// 않으므로, is_active·deleted_at 조건은 쿼리에 명시적으로 재현한다.
//
// ⛔ 2026-09-21 수정: valid_from/valid_until을 SQL에서 .lte()/.gte()로 직접 비교하던 옛
// 필터를 제거했다 — validity_type이 'unlimited'·'relative_days'인 쿠폰은 두 컬럼 모두
// 항상 NULL(Migration #512/514/515/520/521, "무제한"·"첫 확인일로부터 N일" 모드는 절대
// 종료일 개념 자체가 없음)이라, NULL과의 부등호 비교가 PostgREST에서 매번 매칭 실패로
// 평가돼 이 두 타입 쿠폰이 이 관리자 전용 팝업에서 통째로 안 보이던 오래된 결함이었다
// (고객 본인 화면 loadUserCoupons.ts는 이미 이 방식으로 되어 있었음 — 이 파일만 구버전
// SQL 필터가 남아 있었다). relative_days 만료 판정은 loadUserCoupons.ts와 동일하게
// JS에서 first_viewed_at 기준으로 재계산한다(정본 로직 중복 없이 그대로 이식).

import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import type { UserCouponCard } from '$lib/server/account/loadUserCoupons'
import type { RequestHandler } from './$types'

interface RawCoupon {
  code: string | null
  discount_type: string
  discount_value: number
  display_name: string | null
  valid_until: string | null
  min_purchase_amount: number | null
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

export const GET: RequestHandler = async ({ locals, params }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })

  const userId = params.id
  if (!userId) return json({ error: 'id가 필요합니다.' }, { status: 400 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const now = Date.now()

  const { data, error } = await admin
    .from('user_coupons')
    .select(
      'id, used_at, redeemed_code, first_viewed_at, coupons!inner(code, discount_type, discount_value, display_name, valid_until, min_purchase_amount, validity_type, valid_days, is_active, deleted_at)',
    )
    .eq('user_id', userId)
    .eq('coupons.is_active', true)
    .is('coupons.deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) return json({ error: error.message }, { status: 500 })

  const coupons: UserCouponCard[] = ((data ?? []) as unknown as RawUserCouponRow[])
    .filter((row) => row.coupons !== null)
    .filter((row) => {
      // relative_days 만료 제외 — first_viewed_at + valid_days가 지난 쿠폰은 목록에서 뺀다
      // (loadUserCoupons.ts·use_coupon RPC와 동일 판정)
      const c = row.coupons as RawCoupon
      if (c.validity_type === 'relative_days' && row.first_viewed_at && c.valid_days) {
        const expiry = new Date(row.first_viewed_at).getTime() + c.valid_days * 86400_000
        if (expiry < now) return false
      }
      return true
    })
    .map((row) => {
      const c = row.coupons as RawCoupon
      const label =
        c.display_name ??
        (c.discount_type === 'fixed'
          ? `${c.discount_value.toLocaleString('ko-KR')}원 할인`
          : `${c.discount_value}% 할인`)

      const status: UserCouponCard['status'] = row.used_at ? 'used' : 'usable'

      // relative_days 모드는 절대 종료일(valid_until)이 없으므로 first_viewed_at + valid_days로
      // 역산해 표시한다(loadUserCoupons.ts와 동일) — 아직 첫 확인 전이면 null(상시로 표시).
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

  return json(coupons)
}
