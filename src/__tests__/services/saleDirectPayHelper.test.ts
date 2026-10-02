/**
 * TDD: saleDirectPayHelper.test.ts — 판매전용 단독 직접결제 공용 헬퍼(loadDirectPayOrder·ensureDirectPayDeadline)
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트. fixture는 이 파일이 생성·정리한다.
 *
 * 요구(Stephen 2026-10-01):
 *  D) "구매신청"(draft 생성)부터 구매 성격(duration_type='purchase')을 가진다 — 비어 있으면 장바구니가 대여로 오인해 "요금 미정"
 *  O) 옵션상품: 본상품 대여설정(기간·방식)과 무관하게 자체 판매금액×수량이 결제 연산에 포함 + 확정 시 재고 차감(취소 시 복원)
 *  B) 결합상품: 본상품 대여설정(날짜)과 무관하게 재고 차감, 금액은 결합 조건 유지(요금값 제외)
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { loadDirectPayOrder, ensureDirectPayDeadline, buildPaidSuccessQuery, hasEnoughPayTime, DIRECT_PAY_WINDOW_MINUTES } from '$lib/server/checkout/directPay'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'
import { approveTestCustomer } from '../helpers/approveTestCustomer'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const cleanups: Array<() => Promise<void>> = []

let client: SupabaseClient
let userId = ''

beforeAll(async () => {
  const email = `tdd-salepob-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const password = 'Test1234!'
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw new Error(`임시 사용자 생성 실패: ${error?.message}`)
  userId = data.user.id
  await approveTestCustomer(admin, userId)
  client = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
  const { error: signErr } = await client.auth.signInWithPassword({ email, password })
  if (signErr) throw new Error(`로그인 실패: ${signErr.message}`)
}, 60000)

afterAll(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
  await admin.from('rental_reservations').delete().eq('user_id', userId)
  await admin.auth.admin.deleteUser(userId)
}, 240000)

let rangeSeq = 0
/** 겹치지 않는 먼 미래 기간 — 호출마다 다른 구간 */
function range(days = 2): { start: string; end: string } {
  const base = Date.UTC(2033, 0, 1) + rangeSeq++ * 20 * 86400000
  const fmt = (d: number) => new Date(d).toISOString().slice(0, 10)
  return { start: fmt(base), end: fmt(base + days * 86400000) }
}

interface Fixture { parentId: string; childIds: string[] }

async function createProduct(opts: { saleOnly: boolean; salePrice?: number; children?: number }): Promise<Fixture> {
  const tag = `[TDD-SPOB] ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const { data: p, error } = await admin.from('products')
    .insert({ name: tag, category: 'other', is_active: true, sale_only: opts.saleOnly, sale_price: opts.salePrice ?? null })
    .select('id').single()
  if (error || !p) throw new Error(`부모 생성 실패: ${error?.message}`)
  const parentId = (p as { id: string }).id
  const childIds: string[] = []
  for (let i = 0; i < (opts.children ?? 1); i++) {
    const { data: c, error: cErr } = await admin.from('products')
      .insert({ name: `${tag} 자식${i}`, category: 'other', is_active: true, sale_only: opts.saleOnly, sale_price: opts.salePrice ?? null, parent_product_id: parentId })
      .select('id').single()
    if (cErr || !c) throw new Error(`자식 생성 실패: ${cErr?.message}`)
    childIds.push((c as { id: string }).id)
  }
  cleanups.push(async () => {
    for (const cid of childIds) await admin.from('rental_reservations').delete().eq('product_id', cid)
    await admin.from('product_option_links').delete().or(`product_id.eq.${parentId},option_product_id.eq.${parentId}`)
    await admin.from('product_bundle_links').delete().or(`product_id.eq.${parentId},bundle_product_id.eq.${parentId}`)
    await admin.from('products').delete().eq('parent_product_id', parentId)
    await admin.from('products').delete().eq('id', parentId)
  })
  return { parentId, childIds }
}

async function linkOption(mainParent: string, optionParent: string): Promise<void> {
  const { error } = await admin.from('product_option_links').insert({ product_id: mainParent, option_product_id: optionParent })
  if (error) throw new Error(`옵션 링크 실패: ${error.message}`)
}
async function linkBundle(pkgParent: string, memberParent: string): Promise<void> {
  const { error } = await admin.from('product_bundle_links').insert({ product_id: pkgParent, bundle_product_id: memberParent, display_order: 0 })
  if (error) throw new Error(`결합 링크 실패: ${error.message}`)
}

type HoldRow = { success: boolean; reservation_id: number | null; error_message: string | null }
async function tryHold(parentId: string, r = range()): Promise<HoldRow> {
  const { data, error } = await client.rpc('create_hold_reservation', {
    p_product_id: parentId, p_start_date: r.start, p_end_date: r.end,
  })
  const row = (data as HoldRow[] | null)?.[0]
  if (error || !row) throw new Error(`hold RPC 오류: ${error?.message}`)
  return row
}
async function hold(parentId: string, r = range()): Promise<number> {
  const row = await tryHold(parentId, r)
  if (!row.success || !row.reservation_id) throw new Error(`hold 실패: ${row.error_message}`)
  return row.reservation_id
}
async function setOptions(resId: number, opts: Array<{ id: string; qty: number; price?: number }>): Promise<string | null> {
  const { error } = await client.rpc('set_reservation_options', {
    p_reservation_id: resId,
    p_options: opts.map((o) => ({ option_product_id: o.id, option_name: 'opt', qty: o.qty, unit_price: o.price ?? 0 })),
  })
  return error ? error.message : null
}
async function setStatus(resId: number, status: string): Promise<{ ok: boolean; error?: string; sale_stock_shortage?: number }> {
  const { data, error } = await admin.rpc('update_reservation_status', { p_reservation_id: resId, p_new_status: status })
  if (error) throw new Error(`update_reservation_status 오류: ${error.message}`)
  return data as { ok: boolean; error?: string; sale_stock_shortage?: number }
}
async function activeChildren(parentId: string): Promise<number> {
  const { count } = await admin.from('products').select('id', { count: 'exact', head: true })
    .eq('parent_product_id', parentId).eq('is_active', true).is('deleted_at', null)
  return count ?? 0
}
async function marker(childId: string): Promise<number | null> {
  const { data } = await admin.from('products').select('auto_deactivated_reservation_id').eq('id', childId).single()
  return (data as { auto_deactivated_reservation_id: number | null }).auto_deactivated_reservation_id
}
async function optionRow(resId: number, optId: string): Promise<{ qty: number; unit_price: number } | null> {
  const { data } = await admin.from('reservation_options').select('qty, unit_price').eq('reservation_id', resId).eq('option_product_id', optId).maybeSingle()
  return data ? { qty: (data as { qty: number }).qty, unit_price: Number((data as { unit_price: number }).unit_price) } : null
}
async function lineAmount(resId: number): Promise<{ rental_fee: number; options_fee: number }> {
  const { data, error } = await admin.rpc('compute_reservation_line_amount', { p_reservation_id: resId })
  if (error) throw new Error(`compute 오류: ${error.message}`)
  const row = (Array.isArray(data) ? data[0] : data) as { rental_fee: number | string; options_fee: number | string }
  return { rental_fee: Number(row.rental_fee), options_fee: Number(row.options_fee) }
}



async function insertOrder(finalAmount = 10000): Promise<number> {
  const key = `TDD-DPH-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`
  const { data, error } = await admin.from('orders').insert({
    user_id: userId, order_key: key, total_amount: finalAmount, discount_amount: 0, tax_amount: 0, final_amount: finalAmount, status: 'pending', selected_points: 700,
  }).select('id').single()
  if (error || !data) throw new Error(`order 생성 실패: ${error?.message}`)
  const id = (data as { id: number }).id
  cleanups.push(async () => { await admin.from('order_coupons').delete().eq('order_id', id); await admin.from('order_items').delete().eq('order_id', id); await admin.from('orders').delete().eq('id', id) })
  return id
}
async function link(orderId: number, resId: number, productId: string): Promise<void> {
  const { error } = await admin.from('order_items').insert({ order_id: orderId, reservation_id: resId, product_id: productId, quantity: 1, unit_price: 0, line_total: 0 })
  if (error) throw new Error(`order_item 실패: ${error.message}`)
}
async function saleOrder(): Promise<{ orderId: number; resId: number }> {
  const sale = await createProduct({ saleOnly: true, salePrice: 10000, children: 1 })
  const resId = await hold(sale.parentId)
  const orderId = await insertOrder()
  await link(orderId, resId, sale.childIds[0])
  return { orderId, resId }
}

describe('loadDirectPayOrder — 판매전용 단독 주문 검증', () => {
  it('H1 본인의 판매전용 단독 hold 주문 → ok, 금액·포인트·대표예약 반환', async () => {
    const { orderId, resId } = await saleOrder()
    const r = await loadDirectPayOrder(admin, orderId, userId)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.order.finalAmount).toBe(10000)
      expect(r.order.selectedPoints).toBe(700)
      expect(r.order.primaryReservationId).toBe(resId)
      expect(r.order.reservationIds).toEqual([resId])
    }
  }, 60000)

  it('H2 다른 사용자의 주문 → NOT_OWNER', async () => {
    const { orderId } = await saleOrder()
    const r = await loadDirectPayOrder(admin, orderId, '00000000-0000-0000-0000-000000000000')
    expect(r).toEqual({ ok: false, code: 'NOT_OWNER' })
  }, 60000)

  it('H3 대여 상품이 섞인 주문 → NOT_DIRECT_PAY(계약서명 결제 흐름 대상)', async () => {
    const sale = await createProduct({ saleOnly: true, salePrice: 10000, children: 1 })
    const rent = await createProduct({ saleOnly: false, children: 1 })
    const sRes = await hold(sale.parentId)
    const rRes = await hold(rent.parentId)
    const orderId = await insertOrder()
    await link(orderId, sRes, sale.childIds[0])
    await link(orderId, rRes, rent.childIds[0])
    expect(await loadDirectPayOrder(admin, orderId, userId)).toEqual({ ok: false, code: 'NOT_DIRECT_PAY' })
  }, 60000)

  it('H4 대여 상품 단독 주문 → NOT_DIRECT_PAY', async () => {
    const rent = await createProduct({ saleOnly: false, children: 1 })
    const rRes = await hold(rent.parentId)
    const orderId = await insertOrder()
    await link(orderId, rRes, rent.childIds[0])
    expect(await loadDirectPayOrder(admin, orderId, userId)).toEqual({ ok: false, code: 'NOT_DIRECT_PAY' })
  }, 60000)

  it('H5 이미 확정된 주문 → ALREADY_PAID / 만료·취소된 주문 → NOT_ACTIVE', async () => {
    const a = await saleOrder()
    await admin.from('rental_reservations').update({ status: 'confirmed' }).eq('id', a.resId)
    expect(await loadDirectPayOrder(admin, a.orderId, userId)).toEqual({ ok: false, code: 'ALREADY_PAID' })
    const b = await saleOrder()
    await admin.from('rental_reservations').update({ status: 'expired' }).eq('id', b.resId)
    expect(await loadDirectPayOrder(admin, b.orderId, userId)).toEqual({ ok: false, code: 'NOT_ACTIVE' })
    const c = await saleOrder()
    await admin.from('rental_reservations').update({ status: 'cancelled' }).eq('id', c.resId)
    expect(await loadDirectPayOrder(admin, c.orderId, userId)).toEqual({ ok: false, code: 'NOT_ACTIVE' })
  }, 90000)

  it('H6 없는 주문 → ORDER_NOT_FOUND', async () => {
    expect(await loadDirectPayOrder(admin, 999999999, userId)).toEqual({ ok: false, code: 'ORDER_NOT_FOUND' })
  })
})

describe('ensureDirectPayDeadline — 처음 한 번만 설정', () => {
  it('D1 최초 호출은 약 30분 뒤로 설정하고, 다시 호출해도 연장되지 않는다', async () => {
    const { orderId } = await saleOrder()
    const first = await ensureDirectPayDeadline(admin, orderId, null)
    const diffMin = (new Date(first).getTime() - Date.now()) / 60000
    expect(diffMin).toBeGreaterThan(DIRECT_PAY_WINDOW_MINUTES - 1)
    expect(diffMin).toBeLessThanOrEqual(DIRECT_PAY_WINDOW_MINUTES)
    await new Promise((r) => setTimeout(r, 1200))
    const second = await ensureDirectPayDeadline(admin, orderId, null)
    expect(new Date(second).getTime()).toBe(new Date(first).getTime())
    const third = await ensureDirectPayDeadline(admin, orderId, first)
    expect(third).toBe(first)
  }, 60000)
})

describe('buildPaidSuccessQuery — 기존 완료 화면(/payment/success/dev)용 쿼리', () => {
  it('Q1 서버 저장값으로 항목·금액을 조립하고 paid=1을 붙인다', async () => {
    const { orderId, resId } = await saleOrder()
    await admin.from('orders').update({ total_amount: 10000, discount_amount: 0, coupon_discount_amount: 500, delivery_fee: 3500, selected_points: 700, final_amount: 12300 }).eq('id', orderId)
    const loaded = await loadDirectPayOrder(admin, orderId, userId)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    const q = new URLSearchParams(await buildPaidSuccessQuery(admin, loaded.order, '카드'))
    expect(q.get('paid')).toBe('1')
    expect(q.get('amount')).toBe('12300')
    expect(q.get('subtotal')).toBe('10000')
    expect(q.get('couponDiscount')).toBe('500')
    expect(q.get('deliveryFee')).toBe('3500')
    expect(q.get('pointsUsed')).toBe('700')
    expect(q.get('paymentMethod')).toBe('카드')
    const items = JSON.parse(q.get('items') ?? '[]') as Array<{ name: string; code: string }>
    expect(items).toHaveLength(1)
    expect(items[0].name).toContain('[TDD-SPOB]')
    expect(q.get('confirmedAt')).toMatch(/^\d{4}\.\d{2}\.\d{2}·\d{2}:\d{2}$/)
    void resId
  }, 60000)
})

describe('hasEnoughPayTime — 결제창을 열기 위한 최소 잔여 시간', () => {
  const now = Date.UTC(2026, 9, 1, 5, 0, 0)
  it('T1 마감 미설정이면 true, 10분 이상 남으면 true', () => {
    expect(hasEnoughPayTime(null, now)).toBe(true)
    expect(hasEnoughPayTime(new Date(now + 10 * 60_000).toISOString(), now)).toBe(true)
    expect(hasEnoughPayTime(new Date(now + 29 * 60_000).toISOString(), now)).toBe(true)
  })
  it('T2 10분 미만 남았거나 이미 지났으면 false', () => {
    expect(hasEnoughPayTime(new Date(now + 9 * 60_000).toISOString(), now)).toBe(false)
    expect(hasEnoughPayTime(new Date(now - 1000).toISOString(), now)).toBe(false)
  })
})
