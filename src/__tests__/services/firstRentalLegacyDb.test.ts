import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

/**
 * "첫 렌탈 전용" 쿠폰 + 레거시 구매 이력 TDD 통합테스트 — Migration #751 (2026-10-23)
 * 레거시(원 서비스) 구매 이력(user_profiles.legacy_purchase_count > 0)이 있으면 크레이지샷 예약이 0건이어도 첫 렌탈이 아니다.
 * 판정 지점: private._validate_and_consume_coupon (use_coupon 경유)
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트.
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// 실수로 Production을 가리키면 계정·쿠폰을 실제로 만들게 되므로 Stage URL이 아니면 중단
if (!PUBLIC_SUPABASE_URL.includes('ezyvffjvuwmtuhpxdjrw')) throw new Error('이 테스트는 Stage DB 전용입니다')

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

async function createUser(legacy: number | null): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `tdd-firstrental-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`,
    password: 'Test1234!',
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`user 생성 실패: ${error?.message}`)
  const id = data.user.id
  cleanups.push(async () => { await admin.auth.admin.deleteUser(id) })
  const { error: upErr } = await admin.from('user_profiles').update({ legacy_purchase_count: legacy }).eq('id', id)
  if (upErr) throw new Error(`legacy_purchase_count 설정 실패: ${upErr.message}`)
  return id
}

async function createFirstRentalCoupon(): Promise<string> {
  const code = `TEST_FR_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`
  const { data, error } = await admin
    .from('coupons')
    .insert({
      code, type: 'all', validity_type: 'unlimited', discount_type: 'fixed', discount_value: 1000,
      is_active: true, min_purchase_amount: 0, min_rental_amount: 0, min_rental_days: 0,
      is_first_rental_only: true, per_user_limit: 1,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`쿠폰 생성 실패: ${error?.message}`)
  const id = data.id as string
  cleanups.push(async () => {
    await admin.from('user_coupons').delete().eq('coupon_id', id)
    await admin.from('coupons').delete().eq('id', id)
  })
  return id
}

async function giveAndUse(userId: string, couponId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: uc, error: ucErr } = await admin.from('user_coupons').insert({ user_id: userId, coupon_id: couponId }).select('id').single()
  if (ucErr || !uc) throw new Error(`user_coupons 생성 실패: ${ucErr?.message}`)
  const { data, error } = await admin.rpc('use_coupon', { p_user_id: userId, p_user_coupon_id: uc.id as string, p_order_id: null })
  if (error) throw new Error(`use_coupon 오류: ${error.message}`)
  return data as { ok: boolean; error?: string }
}

describe('첫 렌탈 전용 쿠폰 — 레거시 구매 이력 (Migration #751)', () => {
  it('S1: 예약 0건 + 레거시 구매 1건 → FIRST_RENTAL_ONLY로 거절', async () => {
    const couponId = await createFirstRentalCoupon()
    const userId = await createUser(1)
    const r = await giveAndUse(userId, couponId)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('FIRST_RENTAL_ONLY')
  })

  it('S2: 예약 0건 + 레거시 구매 0건 → 사용 가능', async () => {
    const couponId = await createFirstRentalCoupon()
    const userId = await createUser(0)
    const r = await giveAndUse(userId, couponId)
    expect(r.ok).toBe(true)
  })

  it('S3: 예약 0건 + 레거시 구매 NULL → 사용 가능(NULL은 0으로 취급)', async () => {
    const couponId = await createFirstRentalCoupon()
    const userId = await createUser(null)
    const r = await giveAndUse(userId, couponId)
    expect(r.ok).toBe(true)
  })
})
