// GET /api/cms/customers/[id]/coupons — 고객 확인용 쿠폰함 화면(CouponTabContent.svelte)에
// 필요한 데이터를 관리자 채팅 CTA 모달에서 그대로 재사용하기 위한 단건 조회.
//
// $lib/server/account/loadUserCoupons.ts와 동일한 응답 shape(UserCouponCard[])을 만들지만,
// 그 함수는 세션 스코프 클라이언트로 호출돼 "coupons: 유효 쿠폰 조회" RLS 정책(is_active·
// deleted_at·valid_from~valid_until)에 필터링을 위임한다 — 여기는 service-role 클라이언트라
// RLS가 적용되지 않으므로, 그 정책과 동일한 조건을 쿼리에 명시적으로 재현한다
// (supabase/migrations/20260529000015_15_coupons.sql:39-47 참고).

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

export const GET: RequestHandler = async ({ locals, params }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })

  const userId = params.id
  if (!userId) return json({ error: 'id가 필요합니다.' }, { status: 400 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const nowIso = new Date().toISOString()

  const { data, error } = await admin
    .from('user_coupons')
    .select(
      'id, used_at, redeemed_code, coupons!inner(code, discount_type, discount_value, description, valid_until, min_purchase_amount, is_active, deleted_at, valid_from, valid_until)',
    )
    .eq('user_id', userId)
    .eq('coupons.is_active', true)
    .is('coupons.deleted_at', null)
    .lte('coupons.valid_from', nowIso)
    .gte('coupons.valid_until', nowIso)
    .order('created_at', { ascending: false })

  if (error) return json({ error: error.message }, { status: 500 })

  const coupons: UserCouponCard[] = ((data ?? []) as unknown as RawUserCouponRow[])
    .filter((row) => row.coupons !== null)
    .map((row) => {
      const c = row.coupons as RawCoupon
      const label =
        c.description ??
        (c.discount_type === 'fixed'
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

  return json(coupons)
}
