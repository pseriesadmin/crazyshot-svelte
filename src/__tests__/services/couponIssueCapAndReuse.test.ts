import { describe, it, expect, afterEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

/**
 * 쿠폰 "총 발행 개수" + "1인당 사용 횟수" 재정의 TDD 통합테스트 — Migration #623 (2026-10-02, Stephen 확정)
 *
 * ① 총 발행 개수(coupons.total_usage_limit): 0/미설정 = 무제한. N = 이 쿠폰이 N명에게 발급되면 이후 모든 배포 경로가 자동 중단.
 *    (user_coupons INSERT 트리거가 한도 초과 행을 조용히 건너뛴다 — 수동 지급·자동배포·기타 경로 공통)
 * ② 1인당 사용 횟수(coupons.per_user_limit): 0 = 무제한(매번 사용 가능), N = 한 사용자가 N번까지 사용(보유 쿠폰 1행의 used_count).
 *    기본 1 = 기존 동작(한 번 쓰면 끝, ALREADY_USED).
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

async function createUsers(n: number): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    const { data, error } = await admin.auth.admin.createUser({
      email: `tdd-cap-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}@example.com`,
      password: 'Test1234!',
      email_confirm: true,
    })
    if (error || !data.user) throw new Error(`user 생성 실패: ${error?.message}`)
    ids.push(data.user.id)
    cleanups.push(async () => { await admin.auth.admin.deleteUser(data.user!.id) })
  }
  return ids
}

async function createCoupon(spec: { total?: number | null; perUser?: number } = {}): Promise<string> {
  const code = `TEST_CAP_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`
  const { data, error } = await admin
    .from('coupons')
    .insert({
      code, type: 'all', validity_type: 'unlimited', discount_type: 'fixed', discount_value: 1000,
      is_active: true, min_purchase_amount: 0, min_rental_amount: 0, min_rental_days: 0,
      total_usage_limit: spec.total ?? null,
      per_user_limit: spec.perUser ?? 1,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`쿠폰 생성 실패: ${error?.message}`)
  const id = data.id as string
  cleanups.push(async () => {
    await admin.from('user_coupons').delete().eq('coupon_id', id)
    await admin.from('coupon_distributions').delete().eq('coupon_id', id)
    await admin.from('coupons').delete().eq('id', id)
  })
  return id
}

async function issuedCount(couponId: string): Promise<number> {
  const { count, error } = await admin.from('user_coupons').select('id', { count: 'exact', head: true }).eq('coupon_id', couponId)
  if (error) throw new Error(error.message)
  return count ?? 0
}

async function createCmsSession(): Promise<SupabaseClient> {
  const email = `tdd-cap-cms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !data.user) throw new Error(`cms user 생성 실패: ${error?.message}`)
  cleanups.push(async () => { await admin.auth.admin.deleteUser(data.user!.id) })
  const { error: roleErr } = await admin.from('user_profiles').update({ cms_role: 'manager' }).eq('user_id', data.user.id)
  if (roleErr) throw new Error(`cms_role 설정 실패: ${roleErr.message}`)
  const c = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
  const { error: signInErr } = await c.auth.signInWithPassword({ email, password: 'Test1234!' })
  if (signInErr) throw new Error(`로그인 실패: ${signInErr.message}`)
  return c
}

type Rpc = (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
const rpcOf = (c: SupabaseClient): Rpc => c.rpc.bind(c) as unknown as Rpc

async function useCoupon(userId: string, userCouponId: string) {
  const { data, error } = await admin.rpc('use_coupon', { p_user_id: userId, p_user_coupon_id: userCouponId, p_order_id: null })
  if (error) throw new Error(`use_coupon 오류: ${error.message}`)
  return data as { ok: boolean; error?: string }
}


async function createOrder(userId: string): Promise<number> {
  const { data, error } = await admin
    .from('orders')
    .insert({
      user_id: userId,
      order_key: `TEST-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      total_amount: 10000, discount_amount: 0, tax_amount: 0, final_amount: 10000, status: 'pending',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`order 생성 실패: ${error?.message}`)
  const id = data.id as number
  cleanups.push(async () => {
    await admin.from('user_coupons').update({ order_id: null }).eq('order_id', id)
    await admin.from('orders').delete().eq('id', id)
  })
  return id
}

async function useCouponForOrder(userId: string, userCouponId: string, orderId: number) {
  const { data, error } = await admin.rpc('use_coupon', { p_user_id: userId, p_user_coupon_id: userCouponId, p_order_id: orderId })
  if (error) throw new Error(`use_coupon 오류: ${error.message}`)
  return data as { ok: boolean; error?: string }
}

async function holdOf(userId: string, couponId: string): Promise<{ id: string; used_count: number; used_at: string | null }> {
  const { data, error } = await admin.from('user_coupons').select('id, used_count, used_at').eq('user_id', userId).eq('coupon_id', couponId).single()
  if (error || !data) throw new Error(`보유 쿠폰 조회 실패: ${error?.message}`)
  return data as { id: string; used_count: number; used_at: string | null }
}

describe('① 총 발행 개수 — 한도에 도달하면 배포 자동 중단', () => {
  it('N=3이면 한 번에 5명에게 넣어도 3명까지만 발급된다', async () => {
    const couponId = await createCoupon({ total: 3 })
    const users = await createUsers(5)
    await admin.from('user_coupons').insert(users.map((u) => ({ user_id: u, coupon_id: couponId })))
    expect(await issuedCount(couponId)).toBe(3)
  })

  it('한도 도달 뒤 추가 발급 시도는 조용히 건너뛴다(에러 없음)', async () => {
    const couponId = await createCoupon({ total: 1 })
    const [a, b] = await createUsers(2)
    const r1 = await admin.from('user_coupons').insert({ user_id: a, coupon_id: couponId })
    expect(r1.error).toBeNull()
    const r2 = await admin.from('user_coupons').insert({ user_id: b, coupon_id: couponId })
    expect(r2.error).toBeNull()
    expect(await issuedCount(couponId)).toBe(1)
  })

  it('0/미설정은 무제한 — 전원 발급된다', async () => {
    const unlimited = await createCoupon({ total: null })
    const zero = await createCoupon({ total: 0 })
    const users = await createUsers(4)
    await admin.from('user_coupons').insert(users.map((u) => ({ user_id: u, coupon_id: unlimited })))
    await admin.from('user_coupons').insert(users.map((u) => ({ user_id: u, coupon_id: zero })))
    expect(await issuedCount(unlimited)).toBe(4)
    expect(await issuedCount(zero)).toBe(4)
  })

  it('한도를 이미 발급된 수보다 낮춰도 기존 보유분은 그대로이고 신규 발급만 막힌다', async () => {
    const couponId = await createCoupon({ total: null })
    const [a, b, c] = await createUsers(3)
    await admin.from('user_coupons').insert([a, b].map((u) => ({ user_id: u, coupon_id: couponId })))
    await admin.from('coupons').update({ total_usage_limit: 1 }).eq('id', couponId)
    expect(await issuedCount(couponId)).toBe(2)
    await admin.from('user_coupons').insert({ user_id: c, coupon_id: couponId })
    expect(await issuedCount(couponId)).toBe(2)
  })

  it('수동 지급(distribute_coupon): 한도까지만 발급하고 나머지는 limit_reached로 알린다', async () => {
    const couponId = await createCoupon({ total: 2 })
    const users = await createUsers(4)
    const cms = await createCmsSession()
    const res = await rpcOf(cms)('distribute_coupon', {
      p_coupon_id: couponId, p_target_type: 'specific_user', p_target_meta: { user_ids: users },
    })
    expect(res.error).toBeNull()
    const body = res.data as { ok: boolean; issued_count: number; results: Array<{ user_id: string; status: string }> }
    expect(body.ok).toBe(true)
    expect(body.issued_count).toBe(2)
    const statuses = body.results.map((r) => r.status)
    expect(statuses.filter((s) => s === 'issued')).toHaveLength(2)
    expect(statuses.filter((s) => s === 'limit_reached')).toHaveLength(2)
    expect(await issuedCount(couponId)).toBe(2)
  })

  it('사전 조회(preview_distribute_coupon): 남은 개수만큼만 will_issue, 초과분은 limit_reached', async () => {
    const couponId = await createCoupon({ total: 3 })
    const users = await createUsers(5)
    await admin.from('user_coupons').insert({ user_id: users[0], coupon_id: couponId }) // 1명 이미 보유 → 남은 2개
    const cms = await createCmsSession()
    const res = await rpcOf(cms)('preview_distribute_coupon', { p_coupon_id: couponId, p_user_ids: users })
    expect(res.error).toBeNull()
    const body = res.data as { ok: boolean; results: Array<{ status: string }> }
    const statuses = body.results.map((r) => r.status)
    expect(statuses[0]).toBe('already_held')
    expect(statuses.filter((s) => s === 'will_issue')).toHaveLength(2)
    expect(statuses.filter((s) => s === 'limit_reached')).toHaveLength(2)
  })
})

describe('① 총 발행 개수 — 선물 승인(approve_pending_coupon_gift) 연동 (Migration 624)', () => {
  it('한도에 도달한 쿠폰의 선물 승인은 실패하고 카드는 대기 상태로 남는다', async () => {
    const couponId = await createCoupon({ total: 1 })
    const [holder, target] = await createUsers(2)
    await admin.from('user_coupons').insert({ user_id: holder, coupon_id: couponId }) // 한도(1) 소진
    const cms = await createCmsSession()

    // 대상 고객의 채팅 세션 + 선물 대기 카드
    const { data: sess, error: sessErr } = await admin
      .from('chat_sessions').insert({ user_id: target, status: 'open', context_type: 'general' }).select('id').single()
    if (sessErr || !sess) throw new Error(`세션 생성 실패: ${sessErr?.message}`)
    cleanups.push(async () => {
      await admin.from('chat_messages').delete().eq('session_id', sess.id)
      await admin.from('chat_sessions').delete().eq('id', sess.id)
    })
    const { data: msg, error: msgErr } = await admin.from('chat_messages').insert({
      session_id: sess.id, sender_type: 'admin', content: '쿠폰 선물', message_type: 'action_card',
      action_payload: { type: 'COUPON_GIFT_CARD', coupon_id: couponId, approval_status: 'pending', discount_label: '1,000원 할인' },
      is_read: false,
    }).select('id').single()
    if (msgErr || !msg) throw new Error(`카드 생성 실패: ${msgErr?.message}`)

    const { data: me } = await cms.auth.getUser()
    const res = await rpcOf(cms)('approve_pending_coupon_gift', { p_message_id: msg.id, p_admin_id: me.user?.id, p_reject: false })
    const body = res.data as { ok: boolean; error?: string }
    expect(body.ok).toBe(false)
    expect(body.error).toContain('한도')
    expect(await issuedCount(couponId)).toBe(1)
    const { data: after } = await admin.from('chat_messages').select('action_payload').eq('id', msg.id).single()
    expect((after as { action_payload: { approval_status: string } }).action_payload.approval_status).toBe('pending')
  })
})

describe('② 같은 주문 중복 소진 방어 (Migration 625)', () => {
  it('무제한(0) 쿠폰도 같은 주문에서 두 번 소진되지 않고, 다른 주문에서는 다시 쓸 수 있다', async () => {
    const couponId = await createCoupon({ perUser: 0 })
    const [u] = await createUsers(1)
    await admin.from('user_coupons').insert({ user_id: u, coupon_id: couponId })
    const h = await holdOf(u, couponId)
    const orderA = await createOrder(u)
    const orderB = await createOrder(u)

    expect((await useCouponForOrder(u, h.id, orderA)).ok).toBe(true)
    const dup = await useCouponForOrder(u, h.id, orderA) // 더블클릭·재시도
    expect(dup.ok).toBe(false)
    expect(dup.error).toBe('ALREADY_USED')
    expect((await holdOf(u, couponId)).used_count).toBe(1)

    expect((await useCouponForOrder(u, h.id, orderB)).ok).toBe(true) // 다른 주문은 재사용 가능
    expect((await holdOf(u, couponId)).used_count).toBe(2)
  })

  it('N회 쿠폰도 같은 주문 중복 호출은 횟수를 소모하지 않는다', async () => {
    const couponId = await createCoupon({ perUser: 3 })
    const [u] = await createUsers(1)
    await admin.from('user_coupons').insert({ user_id: u, coupon_id: couponId })
    const h = await holdOf(u, couponId)
    const order = await createOrder(u)
    expect((await useCouponForOrder(u, h.id, order)).ok).toBe(true)
    expect((await useCouponForOrder(u, h.id, order)).ok).toBe(false)
    expect((await holdOf(u, couponId)).used_count).toBe(1)
  })
})

describe('② 1인당 사용 횟수 — 0=무제한, N=N번까지', () => {
  it('기본(1회): 한 번 쓰면 다시 쓸 수 없다(ALREADY_USED, 기존 동작 유지)', async () => {
    const couponId = await createCoupon({ perUser: 1 })
    const [u] = await createUsers(1)
    await admin.from('user_coupons').insert({ user_id: u, coupon_id: couponId })
    const h = await holdOf(u, couponId)
    expect((await useCoupon(u, h.id)).ok).toBe(true)
    const again = await useCoupon(u, h.id)
    expect(again.ok).toBe(false)
    expect(again.error).toBe('ALREADY_USED')
  })

  it('N=3: 3번까지 사용되고 4번째는 PER_USER_LIMIT_EXCEEDED', async () => {
    const couponId = await createCoupon({ perUser: 3 })
    const [u] = await createUsers(1)
    await admin.from('user_coupons').insert({ user_id: u, coupon_id: couponId })
    const h = await holdOf(u, couponId)
    for (let i = 1; i <= 3; i++) {
      const r = await useCoupon(u, h.id)
      expect(r.ok).toBe(true)
    }
    expect((await holdOf(u, couponId)).used_count).toBe(3)
    const over = await useCoupon(u, h.id)
    expect(over.ok).toBe(false)
    expect(over.error).toBe('PER_USER_LIMIT_EXCEEDED')
    expect((await holdOf(u, couponId)).used_count).toBe(3)
  })

  it('0=무제한: 여러 번 써도 계속 사용 가능', async () => {
    const couponId = await createCoupon({ perUser: 0 })
    const [u] = await createUsers(1)
    await admin.from('user_coupons').insert({ user_id: u, coupon_id: couponId })
    const h = await holdOf(u, couponId)
    for (let i = 0; i < 5; i++) {
      expect((await useCoupon(u, h.id)).ok).toBe(true)
    }
    expect((await holdOf(u, couponId)).used_count).toBe(5)
  })

  it('쿠폰 전체 사용 누적(usage_count)은 사용할 때마다 늘어난다', async () => {
    const couponId = await createCoupon({ perUser: 2 })
    const [u] = await createUsers(1)
    await admin.from('user_coupons').insert({ user_id: u, coupon_id: couponId })
    const h = await holdOf(u, couponId)
    await useCoupon(u, h.id)
    await useCoupon(u, h.id)
    const { data } = await admin.from('coupons').select('usage_count').eq('id', couponId).single()
    expect((data as { usage_count: number }).usage_count).toBe(2)
  })
})
