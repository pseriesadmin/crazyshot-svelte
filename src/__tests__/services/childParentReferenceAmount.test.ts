/**
 * TDD: 자식 재고의 부모 정보 "복사 → 참조" 전환 — Phase 2A (금액·정책 DB 함수 읽기 전환)
 *
 * 정책: 자식 재고(parent_product_id 있음)는 sale_only·sale_price를 "부모 우선, 자식 폴백"으로 해석한다.
 * 부모와 자식 값이 서로 다른 픽스처(부모=판매전용, 자식=대여)로 부모 우선을 판별하고,
 * 부모 값이 비어 있거나 부모가 없는 경우는 기존 동작(자식 자신의 값)이 유지되는지 회귀로 확인한다.
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트 — 전용 임시 상품·사용자를 만들고 종료 시 삭제한다.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'
import { buildCouponEligibilityContext } from '$lib/server/coupons/couponEligibility'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

const tag = () => `tdd-childref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

async function makeProduct(o: {
  parentId?: string
  saleOnly?: boolean
  salePrice?: number | null
  active?: boolean
  category?: string
  daily?: number
}): Promise<string> {
  const t = tag()
  const { data, error } = await admin
    .from('products')
    .insert({
      name: t, category: o.category ?? 'TDD', slug: t, is_active: o.active ?? false,
      ...(o.parentId ? { parent_product_id: o.parentId } : {}),
      sale_only: o.saleOnly ?? false,
      ...(o.salePrice !== undefined ? { sale_price: o.salePrice } : {}),
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`임시 상품 생성 실패: ${error?.message}`)
  const id = data.id as string
  cleanups.push(async () => {
    await admin.from('price_rules').delete().eq('product_id', id)
    await admin.from('products').delete().eq('id', id)
  })
  if (o.daily) {
    const { error: e } = await admin.from('price_rules').insert({
      product_id: id, duration_type: '24h', price: o.daily, is_active: true, deleted_at: null,
    })
    if (e) throw new Error(`price_rules 생성 실패: ${e.message}`)
  }
  return id
}

const TEST_PASSWORD = 'Test1234!'
const userEmails = new Map<string, string>()

async function makeUser(): Promise<string> {
  const email = `${tag()}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true })
  if (error || !data.user) throw new Error(`임시 사용자 생성 실패: ${error?.message}`)
  const id = data.user.id
  userEmails.set(id, email)
  cleanups.push(async () => { await admin.auth.admin.deleteUser(id) })
  return id
}

async function makeReservation(productId: string, userId: string, status = 'hold'): Promise<number> {
  const { data, error } = await admin
    .from('rental_reservations')
    .insert({
      product_id: productId, user_id: userId,
      start_date: '2030-05-06', end_date: '2030-05-07',
      pickup_time: '10:00', return_time: '10:00', pickup_method: 'visit', status,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`임시 예약 생성 실패: ${error?.message}`)
  const rid = data.id as number
  cleanups.push(async () => {
    await admin.from('order_items').delete().eq('reservation_id', rid)
    await admin.from('rental_reservations').delete().eq('id', rid)
  })
  return rid
}

async function lineAmount(rid: number): Promise<{ rental: number; options: number }> {
  const { data, error } = await admin.rpc('compute_reservation_line_amount', { p_reservation_id: rid })
  if (error) throw new Error(`compute_reservation_line_amount 실패: ${error.message}`)
  const row = (Array.isArray(data) ? data[0] : data) as { rental_fee: number; options_fee: number }
  return { rental: Number(row.rental_fee), options: Number(row.options_fee) }
}

describe('[TDD] Phase 2A — 자식 재고는 sale_only·sale_price를 부모 기준으로 해석한다', () => {
  it('CR-1 compute_reservation_line_amount: 부모=판매전용(50,000)·자식=대여(값 불일치) → 부모 판매가로 계산(숨김 부모여도)', async () => {
    const parent = await makeProduct({ saleOnly: true, salePrice: 50000, active: false })
    const child = await makeProduct({ parentId: parent, saleOnly: false, salePrice: 1, active: true, daily: 99999 })
    const rid = await makeReservation(child, await makeUser())
    expect((await lineAmount(rid)).rental).toBe(50000)
  })

  it('CR-2 [회귀] 부모=대여·자식=판매전용(값 불일치) → 부모(대여) 기준 요금표로 계산', async () => {
    const parent = await makeProduct({ saleOnly: false, active: false })
    const child = await makeProduct({ parentId: parent, saleOnly: true, salePrice: 777, active: true, daily: 100000 })
    const rid = await makeReservation(child, await makeUser())
    expect((await lineAmount(rid)).rental).toBe(100000) // 10:00→다음날 10:00 = 정확히 24시간 = 1일
  })

  it('CR-3 부모 판매가가 비어 있으면(null) 자식 값으로 폴백한다', async () => {
    const parent = await makeProduct({ saleOnly: true, salePrice: null, active: false })
    const child = await makeProduct({ parentId: parent, saleOnly: true, salePrice: 33000, active: true })
    const rid = await makeReservation(child, await makeUser())
    expect((await lineAmount(rid)).rental).toBe(33000)
  })

  it('CR-4 [회귀] 부모가 없는 단독 상품은 자기 값 그대로(판매전용 → 판매가)', async () => {
    const solo = await makeProduct({ saleOnly: true, salePrice: 12000, active: true })
    const rid = await makeReservation(solo, await makeUser())
    expect((await lineAmount(rid)).rental).toBe(12000)
  })

  it('CR-5 assert_reservation_lead_and_period: 부모=판매전용 → 과거 수령일이어도 대여 마감 검사를 건너뛴다', async () => {
    const parent = await makeProduct({ saleOnly: true, salePrice: 1000, active: false })
    const child = await makeProduct({ parentId: parent, saleOnly: false, active: true })
    const { error } = await admin.rpc('assert_reservation_lead_and_period', {
      p_product_id: child, p_start_date: '2020-01-01', p_end_date: '2020-01-02', p_pickup_method: 'visit',
    })
    expect(error).toBeNull()
  })

  it('CR-6 [회귀] 부모=대여 → 과거 수령일은 PICKUP_LEAD_TIME 거절', async () => {
    const parent = await makeProduct({ saleOnly: false, active: false })
    const child = await makeProduct({ parentId: parent, saleOnly: true, active: true })
    const { error } = await admin.rpc('assert_reservation_lead_and_period', {
      p_product_id: child, p_start_date: '2020-01-01', p_end_date: '2020-01-02', p_pickup_method: 'visit',
    })
    expect(error?.message ?? '').toContain('PICKUP_LEAD_TIME')
  })

  it('CR-7 create_reservation_order: 부모=판매전용이면 요금표가 없어도 PRICE_UNSET으로 막지 않는다', async () => {
    const parent = await makeProduct({ saleOnly: true, salePrice: 40000, active: false })
    const child = await makeProduct({ parentId: parent, saleOnly: false, active: true })
    const userId = await makeUser()
    const rid = await makeReservation(child, userId)
    const { data, error } = await admin.rpc('create_reservation_order', {
      p_user_id: userId, p_reservation_ids: [rid], p_selected_coupon_id: null, p_selected_points: 0,
      p_delivery_fee: 0, p_selected_coupon_ids: null,
    })
    expect(error?.message ?? '').not.toContain('PRICE_UNSET')
    const row = (Array.isArray(data) ? data[0] : data) as { order_id: number } | null
    if (row?.order_id) {
      cleanups.push(async () => {
        await admin.from('order_items').delete().eq('order_id', row.order_id)
        await admin.from('orders').delete().eq('id', row.order_id)
      })
    }
    expect(error).toBeNull()
  })

  it('CR-8 [회귀] create_reservation_order: 부모=대여·요금표 없음 → PRICE_UNSET 거절 유지', async () => {
    const parent = await makeProduct({ saleOnly: false, active: false })
    const child = await makeProduct({ parentId: parent, saleOnly: true, salePrice: 1, active: true })
    const userId = await makeUser()
    const rid = await makeReservation(child, userId)
    const { error } = await admin.rpc('create_reservation_order', {
      p_user_id: userId, p_reservation_ids: [rid], p_selected_coupon_id: null, p_selected_points: 0,
      p_delivery_fee: 0, p_selected_coupon_ids: null,
    })
    expect(error?.message ?? '').toContain('PRICE_UNSET')
  })

  it('CR-9 try_confirm_reservation: 부모=판매전용 + 결제완료 → 서명 없이 확정(자식이 대여여도)', async () => {
    const parent = await makeProduct({ saleOnly: true, salePrice: 20000, active: false })
    const child = await makeProduct({ parentId: parent, saleOnly: false, active: true })
    const rid = await makeReservation(child, await makeUser())
    await admin.from('rental_reservations').update({ payment_confirmed_at: new Date().toISOString() }).eq('id', rid)
    const { data, error } = await admin.rpc('try_confirm_reservation', { p_reservation_id: rid })
    expect(error).toBeNull()
    expect(data).toBe(true)
  })

  it('CR-10 [회귀] try_confirm_reservation: 부모=대여 + 결제완료 + 미서명 → 확정하지 않는다', async () => {
    const parent = await makeProduct({ saleOnly: false, active: false })
    const child = await makeProduct({ parentId: parent, saleOnly: true, active: true })
    const rid = await makeReservation(child, await makeUser())
    await admin.from('rental_reservations').update({ payment_confirmed_at: new Date().toISOString() }).eq('id', rid)
    const { data } = await admin.rpc('try_confirm_reservation', { p_reservation_id: rid })
    expect(data).toBe(false)
  })

  it('CR-11 update_reservation_status(확정): 부모=판매전용·자식=대여 → 자식 재고가 즉시 비활성되고 마커가 남는다', async () => {
    const parent = await makeProduct({ saleOnly: true, salePrice: 20000, active: false })
    const child = await makeProduct({ parentId: parent, saleOnly: false, active: true })
    const rid = await makeReservation(child, await makeUser())
    const { data } = await admin.rpc('update_reservation_status', { p_reservation_id: rid, p_new_status: 'confirmed' })
    expect((data as { ok?: boolean } | null)?.ok).toBe(true)
    const { data: row } = await admin.from('products').select('is_active, auto_deactivated_reservation_id').eq('id', child).single()
    expect(row?.is_active).toBe(false)
    expect(row?.auto_deactivated_reservation_id).toBe(rid)
  })

  it('CR-12 update_reservation_status(확정): 부모=대여·자식=판매전용 → 자식 재고를 비활성하지 않는다(부모 기준)', async () => {
    const parent = await makeProduct({ saleOnly: false, active: false })
    const child = await makeProduct({ parentId: parent, saleOnly: true, salePrice: 5, active: true })
    const rid = await makeReservation(child, await makeUser())
    const { data } = await admin.rpc('update_reservation_status', { p_reservation_id: rid, p_new_status: 'confirmed' })
    expect((data as { ok?: boolean } | null)?.ok).toBe(true)
    const { data: row } = await admin.from('products').select('is_active, auto_deactivated_reservation_id').eq('id', child).single()
    expect(row?.is_active).toBe(true)
    expect(row?.auto_deactivated_reservation_id).toBeNull()
  })
})

describe('[TDD] Phase 2A — create_draft_reservation (고객 세션)', () => {
  // 예약 차단 트리거(trg_require_approved_identity_doc)가 승인된 본인증명(주민등록증+등본)을 요구한다
  async function approveIdentity(userId: string) {
    const now = new Date().toISOString()
    const { data, error } = await admin
      .from('user_profiles')
      .update({
        identity_doc_url: ['https://example.com/tdd-id.png'],
        identity_type: ['resident', 'resident_copy'],
        identity_verified_at: now,
        identity_approved_at: now,
      })
      .eq('user_id', userId)
      .select('user_id')
    if (error || !data || data.length === 0) throw new Error(`프로필 승인 설정 실패: ${error?.message ?? '프로필 행 없음'}`)
  }

  async function draftAs(userId: string, productId: string) {
    await approveIdentity(userId)
    const client = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    const email = userEmails.get(userId)
    const { error: se } = await client.auth.signInWithPassword({ email: email ?? '', password: TEST_PASSWORD })
    if (se) throw new Error(`로그인 실패: ${se.message}`)
    const { data, error } = await client.rpc('create_draft_reservation', { p_product_id: productId })
    if (error) throw new Error(`create_draft_reservation 실패: ${error.message}`)
    const row = (Array.isArray(data) ? data[0] : data) as { success: boolean; reservation_id: number | null; error_message: string | null }
    if (row?.reservation_id) {
      const rid = row.reservation_id
      cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', rid) })
    }
    return row
  }

  it('CR-13 판매전용 부모로 임시예약 → duration_type=purchase', async () => {
    const parent = await makeProduct({ saleOnly: true, salePrice: 9000, active: true })
    const row = await draftAs(await makeUser(), parent)
    expect(row.error_message).toBeNull()
    expect(row.success).toBe(true)
    const { data } = await admin.from('rental_reservations').select('duration_type').eq('id', row.reservation_id as number).single()
    expect(data?.duration_type).toBe('purchase')
  })

  it('CR-14 [회귀] 대여 부모로 임시예약 → duration_type 비어 있음', async () => {
    const parent = await makeProduct({ saleOnly: false, active: true })
    const row = await draftAs(await makeUser(), parent)
    expect(row.success).toBe(true)
    const { data } = await admin.from('rental_reservations').select('duration_type').eq('id', row.reservation_id as number).single()
    expect(data?.duration_type).toBeNull()
  })
})

describe('[TDD] Phase 2A — 카테고리 쿠폰 대상 판정은 부모 카테고리 기준 (_validate_and_consume_coupon)', () => {
  async function setup(productId: string, applicable: string[]) {
    const userId = await makeUser()
    const rid = await makeReservation(productId, userId)
    const { data: order, error: oe } = await admin.from('orders').insert({
      user_id: userId, order_key: `TDD-CHILDREF-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      total_amount: 100000, discount_amount: 0, tax_amount: 0, final_amount: 100000, status: 'pending', delivery_fee: 0,
    }).select('id').single()
    if (oe || !order) throw new Error(`주문 생성 실패: ${oe?.message}`)
    const orderId = order.id as number
    const { error: ie } = await admin.from('order_items').insert({
      order_id: orderId, reservation_id: rid, product_id: productId, quantity: 1, unit_price: 100000, line_total: 100000,
    })
    if (ie) throw new Error(`order_items 생성 실패: ${ie.message}`)
    const { data: coupon, error: ce } = await admin.from('coupons').insert({
      code: `TDD_CR_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      type: 'category', applicable_categories: applicable, validity_type: 'fixed_period',
      discount_type: 'fixed', discount_value: 1000, is_active: true, usage_limit: 1, usage_count: 0,
      min_purchase_amount: 0, min_rental_amount: 0, min_rental_days: 0,
      is_first_rental_only: false, is_student_only: false, is_subscription_only: false, is_walk_in_only: false,
      allow_stacking: true, allow_with_points: true, allow_coupon_stacking: true,
    }).select('id').single()
    if (ce || !coupon) throw new Error(`쿠폰 생성 실패: ${ce?.message}`)
    const { data: uc, error: ue } = await admin.from('user_coupons').insert({
      user_id: userId, coupon_id: coupon.id, used_count: 0,
    }).select('id').single()
    if (ue || !uc) throw new Error(`user_coupon 생성 실패: ${ue?.message}`)
    cleanups.push(async () => {
      await admin.from('order_coupons').delete().eq('order_id', orderId)
      await admin.from('user_coupons').delete().eq('id', uc.id)
      await admin.from('order_items').delete().eq('order_id', orderId)
      await admin.from('orders').delete().eq('id', orderId)
      await admin.from('coupons').delete().eq('id', coupon.id)
    })
    return { userId, orderId, ucId: uc.id as string }
  }

  async function useCoupon(userId: string, orderId: number, ucId: string): Promise<{ ok?: boolean; error?: string }> {
    const { data, error } = await admin.rpc('use_coupons', { p_user_id: userId, p_order_id: orderId, p_user_coupon_ids: [ucId] })
    // 거절은 예외 메시지(COUPON_STACK_REJECTED:…:사유)로 돌아오기도 한다 — 둘 다 ok:false로 통일
    if (error) return { ok: false, error: error.message }
    return (data ?? {}) as { ok?: boolean; error?: string }
  }

  it('CR-15 부모 카테고리 쿠폰은 자식 재고 주문에 적용된다(자식 카테고리가 달라도)', async () => {
    const cat = `TDD-PC-${Date.now()}`
    const parent = await makeProduct({ saleOnly: false, active: false, category: cat })
    const child = await makeProduct({ parentId: parent, active: true, category: 'TDD-OLD-COPY' })
    const s = await setup(child, [cat])
    expect((await useCoupon(s.userId, s.orderId, s.ucId)).ok).toBe(true)
  })

  it('CR-16 자식에 남은 옛 카테고리로는 적용되지 않는다(CATEGORY_NOT_APPLICABLE)', async () => {
    const cat = `TDD-PC-${Date.now()}`
    const parent = await makeProduct({ saleOnly: false, active: false, category: cat })
    const child = await makeProduct({ parentId: parent, active: true, category: 'TDD-OLD-COPY' })
    const s = await setup(child, ['TDD-OLD-COPY'])
    const res = await useCoupon(s.userId, s.orderId, s.ucId)
    expect(res.ok).toBe(false)
    expect(JSON.stringify(res)).toContain('CATEGORY_NOT_APPLICABLE')
  })

  it('CR-17 [회귀] 부모가 없는 단독 상품은 자기 카테고리로 판정', async () => {
    const cat = `TDD-SOLO-${Date.now()}`
    const solo = await makeProduct({ saleOnly: false, active: true, category: cat })
    const s = await setup(solo, [cat])
    expect((await useCoupon(s.userId, s.orderId, s.ucId)).ok).toBe(true)
  })

  it('CR-18 화면 쪽 쿠폰 자격 컨텍스트(buildCouponEligibilityContext)도 부모 분류로 판정 자료를 만든다', async () => {
    const cat = `TDD-PC-${Date.now()}`
    const parent = await makeProduct({ saleOnly: false, active: false, category: cat })
    const child = await makeProduct({ parentId: parent, active: true, category: 'TDD-OLD-COPY' })
    const s = await setup(child, [cat])
    const ctx = await buildCouponEligibilityContext(admin, s.userId, s.orderId)
    expect(ctx.cartCategories).toEqual([cat])
  })

  it('CR-19 [회귀] 컨텍스트: 부모 없는 단독 상품은 자기 분류 그대로', async () => {
    const cat = `TDD-SOLO-${Date.now()}`
    const solo = await makeProduct({ saleOnly: false, active: true, category: cat })
    const s = await setup(solo, [cat])
    const ctx = await buildCouponEligibilityContext(admin, s.userId, s.orderId)
    expect(ctx.cartCategories).toEqual([cat])
  })
})
