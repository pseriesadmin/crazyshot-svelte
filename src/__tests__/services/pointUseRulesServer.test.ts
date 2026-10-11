/**
 * TDD: pointUseRulesServer.test.ts — 포인트 사용 규칙의 서버 강제 (Migration #639·#640)
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트. fixture·설정 변경은 이 파일이 만들고 반드시 원복한다.
 *
 * 기대:
 *  - create_reservation_order / sync_order_after_composition_change 가 요청 포인트를 normalize_point_use 규칙
 *    (OFF · 보유 포인트 · 결제금액 · 최대 비율 · 사용 단위 · 최소 사용)으로 보정해 orders.selected_points에 저장한다.
 *  - 이미 use_points로 차감된 주문은 sync가 포인트를 줄이지 않는다(결제 완료 주문의 청구액 사후 변경 방지).
 *  - use_points 는 주문에 저장된 selected_points 를 넘는 차감을 거부한다.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

let productId: string
let originalSettings: { use_enabled: boolean; min_use_points: number; use_unit: number; max_use_ratio: number }
let settingsId: string
const cleanups: Array<() => Promise<void>> = []

async function setRules(p: Partial<typeof originalSettings>): Promise<void> {
  const { error } = await admin.from('point_use_settings').update(p).eq('id', settingsId)
  if (error) throw new Error(`설정 변경 실패: ${error.message}`)
}

beforeAll(async () => {
  // 전용 상품 + 24h 요금: 다른 세션/테스트가 공유 상품의 임시 요금을 지우는 경합(PRICE_UNSET)을 피한다
  const { data: prod, error } = await admin.from('products')
    .insert({ name: `[TDD-POINTRULE] ${Date.now()}`, category: 'other', is_active: true })
    .select('id').single()
  if (error || !prod) throw new Error(`테스트 상품 생성 실패: ${error?.message}`)
  productId = (prod as { id: string }).id
  const { error: prErr } = await admin.from('price_rules').insert({ product_id: productId, duration_type: '24h', price: 25000, is_active: true })
  if (prErr) throw new Error(`테스트 요금 생성 실패: ${prErr.message}`)
  const { data: s } = await admin.from('point_use_settings').select('id, use_enabled, min_use_points, use_unit, max_use_ratio').limit(1).single()
  const row = s as { id: string } & typeof originalSettings
  settingsId = row.id
  originalSettings = { use_enabled: row.use_enabled, min_use_points: row.min_use_points, use_unit: row.use_unit, max_use_ratio: row.max_use_ratio }
}, 60000)

afterEach(async () => {
  await setRules(originalSettings).catch(() => undefined)
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

afterAll(async () => {
  await setRules(originalSettings).catch(() => undefined)
  await admin.from('price_rules').delete().eq('product_id', productId).then(undefined, () => undefined)
  await admin.from('products').delete().eq('id', productId).then(undefined, () => undefined)
})

const _slotBase = Date.now() % 1000
let _slot = 0
function range(): { start: string; end: string } {
  _slot += 1
  const start = new Date(Date.UTC(2046, 0, 1) + (_slotBase * 40 + _slot) * 5 * 86400000)
  const end = new Date(start.getTime() + 2 * 86400000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { start: fmt(start), end: fmt(end) }
}

async function createUser(points: number): Promise<string> {
  const email = `tdd-pointrule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !data.user) throw new Error(`user 생성 실패: ${error?.message}`)
  const uid = data.user.id
  cleanups.push(async () => { await admin.auth.admin.deleteUser(uid) })
  const { error: pErr } = await admin.from('user_profiles').update({ points }).eq('id', uid)
  if (pErr) throw new Error(`포인트 지급 실패: ${pErr.message}`)
  return uid
}

async function createHold(userId: string): Promise<number> {
  const { start, end } = range()
  const { data, error } = await admin.from('rental_reservations').insert({
    user_id: userId, product_id: productId, start_date: start, end_date: end,
    status: 'hold', pickup_method: 'visit', return_method: 'visit',
  }).select('id').single()
  if (error || !data) throw new Error(`reservation 생성 실패: ${error?.message}`)
  const rid = (data as { id: number }).id
  cleanups.push(async () => {
    const { data: items } = await admin.from('order_items').select('order_id').eq('reservation_id', rid)
    const orderIds = ((items ?? []) as { order_id: number }[]).map((i) => i.order_id)
    await admin.from('order_items').delete().eq('reservation_id', rid)
    if (orderIds.length) await admin.from('orders').delete().in('id', orderIds)
    await admin.from('point_transactions').delete().eq('user_id', userId)
    await admin.from('rental_reservations').delete().eq('id', rid)
  })
  return rid
}

interface OrderResult { orderId: number; selectedPoints: number; finalAmount: number; payable: number }

/** 포인트 요청량으로 주문을 만들고 저장 결과를 돌려준다. payable = 포인트 적용 전 결제금액 */
async function orderWithPoints(userId: string, requested: number): Promise<OrderResult> {
  const rid = await createHold(userId)
  const { data, error } = await admin.rpc('create_reservation_order', { p_user_id: userId, p_reservation_ids: [rid], p_selected_points: requested })
  if (error) throw new Error(`create_reservation_order 실패: ${error.message}`)
  const orderId = Number((Array.isArray(data) ? data[0] : data)?.order_id)
  const { data: o } = await admin.from('orders').select('selected_points, final_amount').eq('id', orderId).single()
  const row = o as { selected_points: number; final_amount: number | string }
  const selectedPoints = Number(row.selected_points)
  const finalAmount = Number(row.final_amount)
  return { orderId, selectedPoints, finalAmount, payable: finalAmount + selectedPoints }
}

describe('create_reservation_order — 포인트 사용 규칙 서버 강제', () => {
  it('무회귀(기본 규칙): 보유 포인트 안에서 요청한 만큼 저장', async () => {
    const uid = await createUser(3000)
    const r = await orderWithPoints(uid, 1000)
    expect(r.selectedPoints).toBe(1000)
    expect(r.finalAmount).toBe(r.payable - 1000)
  }, 60000)

  it('보유 포인트를 넘는 요청은 보유 포인트로 보정', async () => {
    const uid = await createUser(700)
    const r = await orderWithPoints(uid, 9_999_999)
    expect(r.selectedPoints).toBeLessThanOrEqual(700)
    expect(r.selectedPoints).toBe(Math.min(700, r.payable))
  }, 60000)

  it('결제금액을 넘는 요청은 결제금액으로 보정(최종 결제금액이 0원 아래로 가지 않음)', async () => {
    const uid = await createUser(100_000_000)
    const r = await orderWithPoints(uid, 99_000_000)
    expect(r.selectedPoints).toBeLessThanOrEqual(r.payable)
    expect(r.finalAmount).toBeGreaterThanOrEqual(0)
  }, 60000)

  it('사용 OFF면 0', async () => {
    await setRules({ use_enabled: false })
    const uid = await createUser(5000)
    const r = await orderWithPoints(uid, 1000)
    expect(r.selectedPoints).toBe(0)
  }, 60000)

  it('사용 단위: 단위 배수로 내림', async () => {
    await setRules({ use_unit: 300 })
    const uid = await createUser(5000)
    const r = await orderWithPoints(uid, 1000)
    expect(r.selectedPoints).toBe(900)
  }, 60000)

  it('최소 사용 포인트: 미만이면 0', async () => {
    await setRules({ min_use_points: 1000 })
    const uid = await createUser(5000)
    expect((await orderWithPoints(uid, 500)).selectedPoints).toBe(0)
    expect((await orderWithPoints(uid, 1000)).selectedPoints).toBe(1000)
  }, 90000)

  it('최대 비율: 결제금액의 N%까지', async () => {
    await setRules({ max_use_ratio: 10 })
    const uid = await createUser(100_000_000)
    const r = await orderWithPoints(uid, 99_000_000)
    expect(r.selectedPoints).toBe(Math.floor(r.payable * 0.1))
  }, 60000)
})

describe('sync_order_after_composition_change · use_points', () => {
  it('sync는 보정한 포인트를 저장값에도 반영한다(규칙 변경 후 재동기화)', async () => {
    const uid = await createUser(5000)
    const r = await orderWithPoints(uid, 1000)
    expect(r.selectedPoints).toBe(1000)

    await setRules({ use_enabled: false })
    const { data, error } = await admin.rpc('sync_order_after_composition_change', { p_order_id: r.orderId })
    expect(error).toBeNull()
    expect((Array.isArray(data) ? data[0] : data)?.success).toBe(true)
    const { data: o } = await admin.from('orders').select('selected_points, final_amount').eq('id', r.orderId).single()
    expect(Number((o as { selected_points: number }).selected_points)).toBe(0)
    expect(Number((o as { final_amount: number | string }).final_amount)).toBe(r.payable)
  }, 60000)

  it('이미 차감된 주문은 sync가 포인트를 줄이지 않는다(사후 청구액 변경 방지)', async () => {
    const uid = await createUser(1000)
    const r = await orderWithPoints(uid, 1000)
    expect(r.selectedPoints).toBe(1000)
    const used = await admin.rpc('use_points', { p_user_id: uid, p_points: 1000, p_order_id: r.orderId })
    expect((used.data as { ok: boolean }).ok).toBe(true)

    // 잔액이 0이 된 뒤 재동기화해도 저장된 포인트·청구액은 유지
    const { data } = await admin.rpc('sync_order_after_composition_change', { p_order_id: r.orderId })
    expect((Array.isArray(data) ? data[0] : data)?.success).toBe(true)
    const { data: o } = await admin.from('orders').select('selected_points, final_amount').eq('id', r.orderId).single()
    expect(Number((o as { selected_points: number }).selected_points)).toBe(1000)
    expect(Number((o as { final_amount: number | string }).final_amount)).toBe(r.finalAmount)
  }, 60000)

  it('use_points: 같은 주문에 동시 요청이 와도 한 번만 차감한다(Migration #642)', async () => {
    const uid = await createUser(3000)
    const r = await orderWithPoints(uid, 1000)
    expect(r.selectedPoints).toBe(1000)

    const results = await Promise.all([
      admin.rpc('use_points', { p_user_id: uid, p_points: 1000, p_order_id: r.orderId }),
      admin.rpc('use_points', { p_user_id: uid, p_points: 1000, p_order_id: r.orderId }),
      admin.rpc('use_points', { p_user_id: uid, p_points: 1000, p_order_id: r.orderId }),
    ])
    for (const x of results) expect((x.data as { ok: boolean }).ok).toBe(true)
    const deductedTotal = results.reduce((n, x) => n + Number((x.data as { deducted: number }).deducted), 0)
    expect(deductedTotal).toBe(1000)

    const { data: p } = await admin.from('user_profiles').select('points').eq('id', uid).single()
    expect(Number((p as { points: number }).points)).toBe(2000)
    const { count } = await admin.from('point_transactions').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('type', 'use')
    expect(count).toBe(1)
  }, 60000)

  it('use_points: 주문 저장 포인트를 넘는 차감은 POINTS_EXCEED_ORDER로 거부, 잔액 불변', async () => {
    const uid = await createUser(5000)
    const r = await orderWithPoints(uid, 1000)
    const res = await admin.rpc('use_points', { p_user_id: uid, p_points: 1500, p_order_id: r.orderId })
    expect((res.data as { ok: boolean; error?: string }).ok).toBe(false)
    expect((res.data as { error?: string }).error).toBe('POINTS_EXCEED_ORDER')
    const { data: p } = await admin.from('user_profiles').select('points').eq('id', uid).single()
    expect(Number((p as { points: number }).points)).toBe(5000)

    const ok = await admin.rpc('use_points', { p_user_id: uid, p_points: 1000, p_order_id: r.orderId })
    expect((ok.data as { ok: boolean }).ok).toBe(true)
  }, 60000)
})

describe('설정 쓰기 권한 (Migration #641) — CMS 직원(partner 포함)도 DB를 직접 바꿀 수 없다', () => {
  async function partnerClient() {
    const email = `tdd-pointrule-partner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
    const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
    if (error || !data.user) throw new Error(`user 생성 실패: ${error?.message}`)
    const uid = data.user.id
    cleanups.push(async () => { await admin.auth.admin.deleteUser(uid) })
    await admin.from('user_profiles').update({ cms_role: 'partner' }).eq('id', uid)
    const client = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    const { error: signErr } = await client.auth.signInWithPassword({ email, password: 'Test1234!' })
    if (signErr) throw new Error(`로그인 실패: ${signErr.message}`)
    return client
  }

  it('partner JWT로 upsert RPC 직접 호출 → 거부, 설정 불변', async () => {
    const c = await partnerClient()
    const { error } = await c.rpc('upsert_point_use_settings', { p_use_enabled: false })
    expect(error).not.toBeNull()
    const { data } = await admin.from('point_use_settings').select('use_enabled').eq('id', settingsId).single()
    expect((data as { use_enabled: boolean }).use_enabled).toBe(originalSettings.use_enabled)
  }, 60000)

  it('partner JWT로 테이블 직접 UPDATE → 거부 또는 0행, 설정 불변', async () => {
    const c = await partnerClient()
    await c.from('point_use_settings').update({ max_use_ratio: 0 }).eq('id', settingsId)
    const { data } = await admin.from('point_use_settings').select('max_use_ratio').eq('id', settingsId).single()
    expect((data as { max_use_ratio: number }).max_use_ratio).toBe(originalSettings.max_use_ratio)
  }, 60000)

  it('공개 조회(get_point_use_settings)는 그대로 가능', async () => {
    const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    const { data, error } = await anon.rpc('get_point_use_settings')
    expect(error).toBeNull()
    expect((data as { use_unit: number }).use_unit).toBe(originalSettings.use_unit)
  })
})
