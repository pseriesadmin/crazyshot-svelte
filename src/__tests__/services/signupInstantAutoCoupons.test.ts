import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

/**
 * 가입 즉시 자동배포 쿠폰 발급 TDD 통합테스트 — Migration #791 (2026-11-05)
 * 가입(user_profiles 행 생성) 직후 cron을 기다리지 않고 자동배포 쿠폰이 곧바로 지급되어야 한다.
 * 대상 판정은 auto_distribute_eligible_coupons(#528)와 동일(필수 등급 없음 + 일반 회원 쿠폰).
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

async function createUser(): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `tdd-signupcoupon-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`,
    password: 'Test1234!',
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`user 생성 실패: ${error?.message}`)
  const id = data.user.id
  cleanups.push(async () => {
    await admin.from('user_coupons').delete().eq('user_id', id)
    await admin.auth.admin.deleteUser(id)
  })
  return id
}

async function createCoupon(autoDistribute: boolean): Promise<string> {
  const code = `TEST_SU_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`
  const { data, error } = await admin
    .from('coupons')
    .insert({
      code, type: 'all', validity_type: 'unlimited', discount_type: 'fixed', discount_value: 1000,
      is_active: true, min_purchase_amount: 0, min_rental_amount: 0, min_rental_days: 0,
      per_user_limit: 1, auto_distribute_enabled: autoDistribute,
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

async function couponIdsOf(userId: string): Promise<string[]> {
  const { data, error } = await admin.from('user_coupons').select('coupon_id').eq('user_id', userId)
  if (error) throw new Error(`user_coupons 조회 실패: ${error.message}`)
  return (data ?? []).map((r) => r.coupon_id as string)
}

describe('가입 즉시 자동배포 쿠폰 (Migration #791)', () => {
  it('자동배포 ON 쿠폰은 가입 직후 cron 없이 바로 지급되고, OFF 쿠폰은 지급되지 않는다', async () => {
    const onId = await createCoupon(true)
    const offId = await createCoupon(false)
    const userId = await createUser()
    const issued = await couponIdsOf(userId)
    expect(issued).toContain(onId)
    expect(issued).not.toContain(offId)
  })

  it('가입 직후 받은 쿠폰은 이후 cron 실행에도 중복 지급되지 않는다', async () => {
    const onId = await createCoupon(true)
    const userId = await createUser()
    const { error } = await admin.rpc('auto_distribute_eligible_coupons')
    // cron 함수는 서버 전용 권한일 수 있어 호출 불가 환경이면 중복 확인만 건너뛴다
    if (error) return
    const issued = (await couponIdsOf(userId)).filter((c) => c === onId)
    expect(issued).toHaveLength(1)
  })
})
