/**
 * TDD: saleDirectPayExpiry.test.ts — 판매전용 단독 직접결제 주문의 미결제 이탈 30분 자동 만료 (Migration 613)
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트. fixture는 이 파일이 생성·정리한다.
 *
 * 요구(Stephen 2026-10-01):
 *  D) "구매신청"(draft 생성)부터 구매 성격(duration_type='purchase')을 가진다 — 비어 있으면 장바구니가 대여로 오인해 "요금 미정"
 *  O) 옵션상품: 본상품 대여설정(기간·방식)과 무관하게 자체 판매금액×수량이 결제 연산에 포함 + 확정 시 재고 차감(취소 시 복원)
 *  B) 결합상품: 본상품 대여설정(날짜)과 무관하게 재고 차감, 금액은 결합 조건 유지(요금값 제외)
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
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


async function insertOrder(opts: { expiresAt: string | null }): Promise<number> {
  const key = `TDD-DP-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`
  const { data, error } = await admin.from('orders').insert({
    user_id: userId, order_key: key, total_amount: 10000, discount_amount: 0, tax_amount: 0, final_amount: 10000, status: 'pending',
    direct_pay_expires_at: opts.expiresAt,
  }).select('id').single()
  if (error || !data) throw new Error(`order 생성 실패: ${error?.message}`)
  const id = (data as { id: number }).id
  cleanups.push(async () => { await admin.from('order_items').delete().eq('order_id', id); await admin.from('orders').delete().eq('id', id) })
  return id
}
async function link(orderId: number, resId: number, productId: string): Promise<void> {
  const { error } = await admin.from('order_items').insert({ order_id: orderId, reservation_id: resId, product_id: productId, quantity: 1, unit_price: 0, line_total: 0 })
  if (error) throw new Error(`order_item 실패: ${error.message}`)
}
async function statusOf(resId: number): Promise<string> {
  const { data } = await admin.from('rental_reservations').select('status').eq('id', resId).single()
  return (data as { status: string }).status
}
const PAST = () => new Date(Date.now() - 60_000).toISOString()
const FUTURE = () => new Date(Date.now() + 25 * 60_000).toISOString()

async function saleHold(): Promise<{ resId: number; childId: string }> {
  const sale = await createProduct({ saleOnly: true, salePrice: 10000, children: 1 })
  const resId = await hold(sale.parentId)
  return { resId, childId: sale.childIds[0] }
}

describe('판매전용 단독 직접결제 — 미결제 이탈 자동 만료 (Migration 613)', () => {
  it('X1 기한(direct_pay_expires_at)이 지난 단독 판매 주문의 미결제 hold → expired', async () => {
    const { resId, childId } = await saleHold()
    const oid = await insertOrder({ expiresAt: PAST() })
    await link(oid, resId, childId)
    await admin.rpc('release_reservation_hold')
    expect(await statusOf(resId)).toBe('expired')
  }, 60000)

  it('X2 기한 전이면 유지', async () => {
    const { resId, childId } = await saleHold()
    const oid = await insertOrder({ expiresAt: FUTURE() })
    await link(oid, resId, childId)
    await admin.rpc('release_reservation_hold')
    expect(await statusOf(resId)).toBe('hold')
  }, 60000)

  it('X3 기한 미설정(기존 신청 주문)은 아무리 오래돼도 유지 — 기존 정책 무영향', async () => {
    const { resId, childId } = await saleHold()
    const oid = await insertOrder({ expiresAt: null })
    await link(oid, resId, childId)
    await admin.rpc('release_reservation_hold')
    expect(await statusOf(resId)).toBe('hold')
  }, 60000)

  it('X4 결제 완료(payment_confirmed_at)된 건은 기한이 지나도 만료되지 않는다', async () => {
    const { resId, childId } = await saleHold()
    const oid = await insertOrder({ expiresAt: PAST() })
    await link(oid, resId, childId)
    await admin.from('rental_reservations').update({ payment_confirmed_at: new Date().toISOString() }).eq('id', resId)
    await admin.rpc('release_reservation_hold')
    expect(await statusOf(resId)).toBe('hold')
  }, 60000)

  it('X5 대여 상품이 섞인 주문은 기한 값이 있어도 만료되지 않는다(혼합 주문 정책 유지)', async () => {
    const { resId, childId } = await saleHold()
    const rent = await createProduct({ saleOnly: false, children: 1 })
    const rentRes = await hold(rent.parentId)
    const oid = await insertOrder({ expiresAt: PAST() })
    await link(oid, resId, childId)
    await link(oid, rentRes, rent.childIds[0])
    await admin.rpc('release_reservation_hold')
    expect(await statusOf(resId)).toBe('hold')
    expect(await statusOf(rentRes)).toBe('hold')
  }, 60000)

  it('X6 만료되면 재고가 풀려 다른 사람이 같은 판매상품을 다시 신청할 수 있다', async () => {
    const sale = await createProduct({ saleOnly: true, salePrice: 10000, children: 1 })
    const r = range()
    const first = await hold(sale.parentId, r)
    const oid = await insertOrder({ expiresAt: PAST() })
    await link(oid, first, sale.childIds[0])
    const before = await tryHold(sale.parentId, r)
    expect(before.success).toBe(false)
    await admin.rpc('release_reservation_hold')
    const after = await tryHold(sale.parentId, r)
    expect(after.success).toBe(true)
  }, 60000)
})
