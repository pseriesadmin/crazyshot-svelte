/**
 * pickupLeadServerGuard.test.ts
 * 수령일 신청 마감(리드타임) + 최대 대여일 서버 재검증 (Migration 588)
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트 — 임시 상품·사용자만 사용하고 정리한다.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'
import { parseLeadRuleText, resolveLeadRule } from '$lib/utils/pickupLeadTime'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})
const tag = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const todayKst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
const FAR = '2032-03-10'

async function makeProduct(o: { saleOnly?: boolean; children?: number } = {}): Promise<string> {
  const name = `tdd-pickuplead-${tag()}`
  const { data, error } = await admin
    .from('products')
    .insert({ name, category: 'TDD', slug: name, is_active: true, ...(o.saleOnly ? { sale_only: true, sale_price: 30000 } : {}) })
    .select('id').single()
  if (error || !data) throw new Error(`상품 생성 실패: ${error?.message}`)
  const id = data.id as string
  cleanups.push(async () => {
    await admin.from('products').delete().eq('parent_product_id', id)
    await admin.from('price_rules').delete().eq('product_id', id)
    await admin.from('products').delete().eq('id', id)
  })
  for (let i = 0; i < (o.children ?? 0); i++) {
    const { error: ce } = await admin.from('products').insert({
      name: `${name}-c${i}`, category: 'TDD', slug: `${name}-c${i}`, is_active: true, parent_product_id: id,
      ...(o.saleOnly ? { sale_only: true, sale_price: 30000 } : {}),
    })
    if (ce) throw new Error(`자식 생성 실패: ${ce.message}`)
  }
  return id
}

async function makeSession(): Promise<SupabaseClient> {
  const email = `tdd-pickuplead-${tag()}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !data.user) throw new Error(`사용자 생성 실패: ${error?.message}`)
  const uid = data.user.id
  cleanups.push(async () => {
    await admin.from('rental_reservations').delete().eq('user_id', uid)
    await admin.auth.admin.deleteUser(uid)
  })
  const c = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
  const { error: se } = await c.auth.signInWithPassword({ email, password: 'Test1234!' })
  if (se) throw new Error(`로그인 실패: ${se.message}`)
  return c
}

async function deliveryKey(): Promise<string | null> {
  const { data } = await admin.from('rental_method_options').select('method_key').eq('is_active', true).is('deleted_at', null).eq('is_delivery_type', true).order('display_order').limit(1)
  return (data?.[0] as { method_key?: string } | undefined)?.method_key ?? null
}
async function maxDays(): Promise<number> {
  const { data } = await admin.from('rental_shipping_settings').select('max_rental_days').limit(1).single()
  return (data as { max_rental_days: number } | null)?.max_rental_days ?? 0
}

async function assertGuard(productId: string, start: string | null, end: string | null, method: string | null) {
  return admin.rpc('assert_reservation_lead_and_period', { p_product_id: productId, p_start_date: start, p_end_date: end, p_pickup_method: method })
}

describe('[TDD] parse_lead_rule_text — TS parseLeadRuleText와 패리티', () => {
  const cases = [
    '예약 대여일 2일 전 오후 7시까지', '예약 대여일 1일 전 오후 7시까지', '대여일 3일 전 18:00까지',
    '1일 전 오후 12시까지', '1일 전 오전 9시까지', '1일 전 오전 12시까지', '20:00 마감 임박', '15:00 마감',
    '대여일 2일 전까지', '주말 및 영업 외 시간 이용시 무인', '',
  ]
  it.each(cases)('"%s"', async (text) => {
    const { data, error } = await admin.rpc('parse_lead_rule_text', { p_text: text })
    expect(error).toBeNull()
    const row = (data as Array<{ lead_days: number; cutoff_hour: number }>)?.[0] ?? null
    const ts = parseLeadRuleText(text)
    expect(row ? { leadDays: row.lead_days, cutoffHour: row.cutoff_hour } : null).toEqual(ts)
  })
  it('get_pickup_lead_rule = resolveLeadRule (활성 방식 전부)', async () => {
    const { data: opts } = await admin.from('rental_method_options').select('method_key, is_delivery_type, deadline_time, display_order').eq('is_active', true).is('deleted_at', null).order('display_order')
    const seen = new Set<string>()
    for (const o of (opts ?? []) as Array<{ method_key: string; is_delivery_type: boolean; deadline_time: string | null }>) {
      if (!o.method_key || seen.has(o.method_key)) continue
      seen.add(o.method_key)
      const { data } = await admin.rpc('get_pickup_lead_rule', { p_method_key: o.method_key })
      const r = (data as Array<{ lead_days: number; cutoff_hour: number }>)[0]
      expect({ leadDays: r.lead_days, cutoffHour: r.cutoff_hour }).toEqual(resolveLeadRule({ isDeliveryType: !!o.is_delivery_type, deadlineText: o.deadline_time }))
    }
    expect(seen.size).toBeGreaterThan(0)
  })
})

describe('[TDD] assert_reservation_lead_and_period — 신청 마감·최대 대여일', () => {
  it('LG-1: 방문 — 어제·오늘 수령은 PICKUP_LEAD_TIME으로 거부', async () => {
    const p = await makeProduct()
    expect((await assertGuard(p, addDays(todayKst(), -1), null, 'visit')).error?.message ?? '').toMatch(/PICKUP_LEAD_TIME/)
    expect((await assertGuard(p, todayKst(), null, 'visit')).error?.message ?? '').toMatch(/PICKUP_LEAD_TIME/)
  })
  it('LG-2: 방문 — 먼 미래 수령은 통과', async () => {
    const p = await makeProduct()
    expect((await assertGuard(p, FAR, FAR, 'visit')).error).toBeNull()
  })
  it('LG-3: 배송형 — 내일 수령은 거부(2일 전 규칙)', async () => {
    const key = await deliveryKey()
    if (!key) return
    const p = await makeProduct()
    expect((await assertGuard(p, addDays(todayKst(), 1), null, key)).error?.message ?? '').toMatch(/PICKUP_LEAD_TIME/)
  })
  it('LG-4: 판매전용(sale_only)은 오늘 수령이어도 제외', async () => {
    const p = await makeProduct({ saleOnly: true })
    expect((await assertGuard(p, todayKst(), todayKst(), 'crazydelivery')).error).toBeNull()
  })
  it('LG-5: 방식 미지정은 방문으로 간주 — 오늘 수령 거부', async () => {
    const p = await makeProduct()
    expect((await assertGuard(p, todayKst(), null, null)).error?.message ?? '').toMatch(/PICKUP_LEAD_TIME/)
  })
  it('LG-6: 수령일 미지정(null)은 검사하지 않음', async () => {
    const p = await makeProduct()
    expect((await assertGuard(p, null, null, 'visit')).error).toBeNull()
  })
  it('LG-7: 일반 방식 최대 대여일 — 차이 max일까지 통과, max+1 초과 거부', async () => {
    const max = await maxDays()
    if (!max) return
    const p = await makeProduct()
    expect((await assertGuard(p, FAR, addDays(FAR, max), 'visit')).error).toBeNull()
    expect((await assertGuard(p, FAR, addDays(FAR, max + 1), 'visit')).error?.message ?? '').toMatch(/RENTAL_PERIOD_EXCEEDED/)
  })
  it('LG-8: 배송형 최대 대여일 — 포함 일수(차이+1) 기준', async () => {
    const key = await deliveryKey()
    const max = await maxDays()
    if (!key || !max) return
    const p = await makeProduct()
    expect((await assertGuard(p, FAR, addDays(FAR, max - 1), key)).error).toBeNull()
    expect((await assertGuard(p, FAR, addDays(FAR, max), key)).error?.message ?? '').toMatch(/RENTAL_PERIOD_EXCEEDED/)
  })
})

describe('[TDD] 고객 경로 RPC 통합 — 서버가 실제로 막는다', () => {
  it('IN-1: create_hold_reservation — 오늘 수령 방문 예약은 거부, 먼 미래는 마감 오류 없음', async () => {
    const client = await makeSession()
    const p = await makeProduct({ children: 1 })
    const { data: bad } = await client.rpc('create_hold_reservation', { p_product_id: p, p_start_date: todayKst(), p_end_date: todayKst(), p_pickup_method: 'visit', p_return_method: 'visit' })
    const b = (bad as Array<{ success: boolean; error_message: string | null }>)[0]
    expect(b.success).toBe(false)
    expect(b.error_message ?? '').toMatch(/PICKUP_LEAD_TIME/)
    const { data: ok } = await client.rpc('create_hold_reservation', { p_product_id: p, p_start_date: FAR, p_end_date: FAR, p_pickup_method: 'visit', p_return_method: 'visit' })
    const g = (ok as Array<{ success: boolean; error_message: string | null }>)[0]
    expect(g.error_message ?? '').not.toMatch(/PICKUP_LEAD_TIME|RENTAL_PERIOD/)
  })
  it('IN-2: promote_draft_reservation — 오늘 수령 승격 거부(draft 유지), 먼 미래는 승격 성공', async () => {
    const client = await makeSession()
    const p = await makeProduct({ children: 2 })
    const { data: d1 } = await client.rpc('create_draft_reservation', { p_product_id: p })
    const rid = (d1 as Array<{ reservation_id: number }>)[0].reservation_id
    const { data: bad } = await client.rpc('promote_draft_reservation', { p_reservation_id: rid, p_start_date: todayKst(), p_end_date: todayKst(), p_pickup_method: 'visit', p_return_method: 'visit' })
    const b = (bad as Array<{ success: boolean; error_message: string | null }>)[0]
    expect(b.success).toBe(false)
    expect(b.error_message ?? '').toMatch(/PICKUP_LEAD_TIME/)
    const { data: st } = await admin.from('rental_reservations').select('status').eq('id', rid).single()
    expect((st as { status: string }).status).toBe('draft')
    const { data: ok } = await client.rpc('promote_draft_reservation', { p_reservation_id: rid, p_start_date: FAR, p_end_date: FAR, p_pickup_method: 'visit', p_return_method: 'visit' })
    expect((ok as Array<{ success: boolean }>)[0].success).toBe(true)
  })
  it('IN-3: 판매전용 구매 건은 오늘 날짜·crazydelivery로도 승격된다(구매 흐름 무회귀)', async () => {
    const client = await makeSession()
    const p = await makeProduct({ saleOnly: true, children: 1 })
    const { data: d1 } = await client.rpc('create_draft_reservation', { p_product_id: p })
    const rid = (d1 as Array<{ reservation_id: number }>)[0].reservation_id
    const { data } = await client.rpc('promote_draft_reservation', { p_reservation_id: rid, p_start_date: todayKst(), p_end_date: todayKst(), p_pickup_method: 'crazydelivery', p_return_method: 'crazydelivery' })
    expect((data as Array<{ success: boolean; error_message: string | null }>)[0].error_message ?? '').not.toMatch(/PICKUP_LEAD_TIME/)
  })
})
