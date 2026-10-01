import { describe, it, expect, afterEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

/**
 * 쿠폰 "적용 대상"(대여상품/판매상품) 설정 TDD 통합테스트 — Migration #615
 *
 * 정책(Stephen 확정, 2026-10-01):
 *  - 쿠폰마다 적용 대상을 대여상품·판매상품 중 하나 또는 둘 다 선택한다. 기본값은 둘 다(기존 쿠폰 동작 불변).
 *  - 둘 다 끄는 것은 불가(최소 1개). 저장은 CMS 직원만(cms_set_coupon_applies_to).
 *  - 이번 범위는 CMS 설정 저장까지다. 장바구니·결제 서버의 적용 차단은 사용자 개발 세션에서 연동한다.
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트.
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

async function createCoupon(): Promise<string> {
  const code = `TEST_APPLIES_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`
  const { data, error } = await admin
    .from('coupons')
    .insert({
      code, type: 'all', validity_type: 'unlimited', discount_type: 'fixed', discount_value: 1000,
      is_active: true, min_purchase_amount: 0, min_rental_amount: 0, min_rental_days: 0,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`쿠폰 생성 실패: ${error?.message}`)
  const id = data.id as string
  cleanups.push(async () => { await admin.from('coupons').delete().eq('id', id) })
  return id
}

async function readFlags(id: string): Promise<{ applies_to_rental: boolean; applies_to_sale: boolean }> {
  const { data, error } = await admin.from('coupons').select('applies_to_rental, applies_to_sale').eq('id', id).single()
  if (error || !data) throw new Error(`조회 실패: ${error?.message}`)
  return data as { applies_to_rental: boolean; applies_to_sale: boolean }
}

async function createSession(cmsRole: string | null): Promise<SupabaseClient> {
  const email = `tdd-applies-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const password = 'Test1234!'
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`)
  const userId = data.user.id
  cleanups.push(async () => { await admin.auth.admin.deleteUser(userId).catch(() => undefined) })
  if (cmsRole) {
    const { error: roleErr } = await admin.from('user_profiles').update({ cms_role: cmsRole }).eq('user_id', userId)
    if (roleErr) throw new Error(`cms_role 설정 실패: ${roleErr.message}`)
  }
  const asUser = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
  const { error: signInErr } = await asUser.auth.signInWithPassword({ email, password })
  if (signInErr) throw new Error(`ephemeral user 로그인 실패: ${signInErr.message}`)
  return asUser
}

type RpcResult = { data: { ok?: boolean; error?: string } | null; error: { message: string } | null }
const setApplies = (c: SupabaseClient, id: string, rental: boolean, sale: boolean) =>
  (c.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<RpcResult>)(
    'cms_set_coupon_applies_to', { p_id: id, p_rental: rental, p_sale: sale },
  )

describe('쿠폰 적용 대상(대여/판매) 설정 (#615)', () => {
  it('새 쿠폰의 기본값은 대여·판매 둘 다 적용이다(기존 쿠폰 동작 불변)', async () => {
    const id = await createCoupon()
    expect(await readFlags(id)).toEqual({ applies_to_rental: true, applies_to_sale: true })
  })

  it('CMS 직원은 대여만 / 판매만 / 둘 다로 저장할 수 있다', async () => {
    const id = await createCoupon()
    const cms = await createSession('manager')

    const r1 = await setApplies(cms, id, true, false)
    expect(r1.error).toBeNull()
    expect(r1.data?.ok).toBe(true)
    expect(await readFlags(id)).toEqual({ applies_to_rental: true, applies_to_sale: false })

    const r2 = await setApplies(cms, id, false, true)
    expect(r2.data?.ok).toBe(true)
    expect(await readFlags(id)).toEqual({ applies_to_rental: false, applies_to_sale: true })

    const r3 = await setApplies(cms, id, true, true)
    expect(r3.data?.ok).toBe(true)
    expect(await readFlags(id)).toEqual({ applies_to_rental: true, applies_to_sale: true })
  })

  it('둘 다 끄는 저장은 거절되고 기존 값이 유지된다', async () => {
    const id = await createCoupon()
    const cms = await createSession('manager')
    await setApplies(cms, id, true, false)

    const bad = await setApplies(cms, id, false, false)
    expect(bad.data?.ok).toBe(false)
    expect(bad.data?.error).toBe('APPLIES_TO_REQUIRED')
    expect(await readFlags(id)).toEqual({ applies_to_rental: true, applies_to_sale: false })
  })

  it('DB 제약: 직접 UPDATE로도 둘 다 끌 수 없다', async () => {
    const id = await createCoupon()
    const { error } = await admin.from('coupons').update({ applies_to_rental: false, applies_to_sale: false }).eq('id', id)
    expect(error).not.toBeNull()
  })

  it('일반 로그인 사용자·익명은 저장할 수 없다', async () => {
    const id = await createCoupon()
    const customer = await createSession(null)
    const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)

    const asCustomer = await setApplies(customer, id, true, false)
    expect(asCustomer.error !== null || asCustomer.data?.ok !== true).toBe(true)
    const asAnon = await setApplies(anon, id, true, false)
    expect(asAnon.error).not.toBeNull()
    expect(await readFlags(id)).toEqual({ applies_to_rental: true, applies_to_sale: true })
  })

  it('존재하지 않는 쿠폰은 COUPON_NOT_FOUND', async () => {
    const cms = await createSession('manager')
    const r = await setApplies(cms, '00000000-0000-0000-0000-000000000000', true, true)
    expect(r.data?.ok).toBe(false)
    expect(r.data?.error).toBe('COUPON_NOT_FOUND')
  })
})
