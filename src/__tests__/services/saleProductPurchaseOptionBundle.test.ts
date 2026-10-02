/**
 * TDD: saleProductPurchaseOptionBundle.test.ts — 판매전용 상품 구매 유형·옵션/결합상품 판매·재고 차감 (Migration 611)
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

describe('D. 구매신청(draft 생성)부터 구매 성격을 가진다', () => {
  it('D1 판매전용 상품 draft → duration_type = purchase', async () => {
    const sale = await createProduct({ saleOnly: true, salePrice: 16500 })
    const { data } = await client.rpc('create_draft_reservation', { p_product_id: sale.parentId })
    const row = (data as HoldRow[])[0]
    expect(row.success).toBe(true)
    const { data: rr } = await admin.from('rental_reservations').select('duration_type, status').eq('id', row.reservation_id!).single()
    expect((rr as { duration_type: string | null }).duration_type).toBe('purchase')
    expect((rr as { status: string }).status).toBe('draft')
  })

  it('D2 대여 상품 draft → duration_type 비어 있음(기존 동작 유지)', async () => {
    const rent = await createProduct({ saleOnly: false })
    const { data } = await client.rpc('create_draft_reservation', { p_product_id: rent.parentId })
    const row = (data as HoldRow[])[0]
    expect(row.success).toBe(true)
    const { data: rr } = await admin.from('rental_reservations').select('duration_type').eq('id', row.reservation_id!).single()
    expect((rr as { duration_type: string | null }).duration_type).toBeNull()
  })
})

describe('O. 판매전용 옵션상품 — 자체 판매금액×수량 결제 포함, 본상품 대여설정과 무관, 확정 시 재고 차감', () => {
  it('O1 단가는 서버가 sale_price로 강제(클라이언트 값 무시)', async () => {
    const main = await createProduct({ saleOnly: false })
    const opt = await createProduct({ saleOnly: true, salePrice: 13500, children: 3 })
    await linkOption(main.parentId, opt.parentId)
    const rid = await hold(main.parentId)
    expect(await setOptions(rid, [{ id: opt.parentId, qty: 2, price: 0 }])).toBeNull()
    expect(await optionRow(rid, opt.parentId)).toEqual({ qty: 2, unit_price: 13500 })
  })

  it('O2 일반(대여) 옵션은 기존대로 클라이언트 단가 유지(회귀 없음)', async () => {
    const main = await createProduct({ saleOnly: false })
    const opt = await createProduct({ saleOnly: false, children: 3 })
    await linkOption(main.parentId, opt.parentId)
    const rid = await hold(main.parentId)
    expect(await setOptions(rid, [{ id: opt.parentId, qty: 1, price: 7700 }])).toBeNull()
    expect(await optionRow(rid, opt.parentId)).toEqual({ qty: 1, unit_price: 7700 })
  })

  it('O3 옵션 금액은 본상품 대여기간과 무관한 정액(수량×판매가) — 1일·4일 동일', async () => {
    const main = await createProduct({ saleOnly: false })
    const opt = await createProduct({ saleOnly: true, salePrice: 13500, children: 6 })
    await linkOption(main.parentId, opt.parentId)
    const short = await hold(main.parentId, range(0))
    const long = await hold(main.parentId, range(4))
    await setOptions(short, [{ id: opt.parentId, qty: 2 }])
    await setOptions(long, [{ id: opt.parentId, qty: 2 }])
    expect((await lineAmount(short)).options_fee).toBe(27000)
    expect((await lineAmount(long)).options_fee).toBe(27000)
  })

  it('O4 재고 가드 — 활성 유닛 수 초과 금지, 다른 hold가 잡은 수량 차감, 확정분은 이중으로 세지 않음', async () => {
    const main = await createProduct({ saleOnly: false })
    const opt = await createProduct({ saleOnly: true, salePrice: 5000, children: 3 })
    await linkOption(main.parentId, opt.parentId)
    const a = await hold(main.parentId)
    expect(await setOptions(a, [{ id: opt.parentId, qty: 4 }])).toMatch(/OPTION_STOCK_EXCEEDED/)
    expect(await setOptions(a, [{ id: opt.parentId, qty: 2 }])).toBeNull()
    const b = await hold(main.parentId)
    expect(await setOptions(b, [{ id: opt.parentId, qty: 2 }])).toMatch(/OPTION_STOCK_EXCEEDED/) // a가 2 점유 → 남은 1
    expect(await setOptions(b, [{ id: opt.parentId, qty: 1 }])).toBeNull()
    // a 확정 → 유닛 2개 비활성화. 이후 c는 남은 1(활성 1 − b의 hold 1 = 0)이 아니라 정확히 계산되어야 함
    expect((await setStatus(a, 'confirmed')).ok).toBe(true)
    expect(await activeChildren(opt.parentId)).toBe(1)
    const c = await hold(main.parentId)
    expect(await setOptions(c, [{ id: opt.parentId, qty: 1 }])).toMatch(/OPTION_STOCK_EXCEEDED/) // 활성 1 − b hold 1 = 0
  })

  it('O5 확정 → 수량만큼 옵션 재고 비활성(마커=예약id), 취소 → 복원', async () => {
    const main = await createProduct({ saleOnly: false })
    const opt = await createProduct({ saleOnly: true, salePrice: 5000, children: 3 })
    await linkOption(main.parentId, opt.parentId)
    const rid = await hold(main.parentId)
    await setOptions(rid, [{ id: opt.parentId, qty: 2 }])
    expect(await activeChildren(opt.parentId)).toBe(3) // hold 단계에서는 유닛을 건드리지 않음
    expect((await setStatus(rid, 'confirmed')).ok).toBe(true)
    expect(await activeChildren(opt.parentId)).toBe(1)
    const marked = (await Promise.all(opt.childIds.map(marker))).filter((m) => m === rid).length
    expect(marked).toBe(2)
    expect((await setStatus(rid, 'cancelled')).ok).toBe(true)
    expect(await activeChildren(opt.parentId)).toBe(3)
    expect((await Promise.all(opt.childIds.map(marker))).every((m) => m === null)).toBe(true)
  })

  it('O6 확정 시 재고가 모자라면 가능한 만큼만 차감하고 부족 수량을 알린다(확정 자체는 성공)', async () => {
    const main = await createProduct({ saleOnly: false })
    const opt = await createProduct({ saleOnly: true, salePrice: 5000, children: 2 })
    await linkOption(main.parentId, opt.parentId)
    const rid = await hold(main.parentId)
    await setOptions(rid, [{ id: opt.parentId, qty: 2 }])
    await admin.from('products').update({ is_active: false }).eq('id', opt.childIds[0]) // 관리자 수동 비활성
    const res = await setStatus(rid, 'confirmed')
    expect(res.ok).toBe(true)
    expect(res.sale_stock_shortage).toBe(1)
    expect(await activeChildren(opt.parentId)).toBe(0)
  })

  it('O7 대여(일반) 옵션은 확정·취소에도 재고 상태 무변화(회귀 없음)', async () => {
    const main = await createProduct({ saleOnly: false })
    const opt = await createProduct({ saleOnly: false, children: 3 })
    await linkOption(main.parentId, opt.parentId)
    const rid = await hold(main.parentId)
    await setOptions(rid, [{ id: opt.parentId, qty: 2 }])
    await setStatus(rid, 'confirmed')
    expect(await activeChildren(opt.parentId)).toBe(3)
    await setStatus(rid, 'cancelled')
    expect(await activeChildren(opt.parentId)).toBe(3)
  })
})

describe('B. 판매전용 결합상품 — 본상품 날짜와 무관하게 재고 차감, 금액은 결합 조건(요금값 제외)', () => {
  it('B1 판매 결합 구성품은 날짜가 달라도 중복 배정되지 않는다(날짜 무관 점유)', async () => {
    const pkg = await createProduct({ saleOnly: false, children: 2 })
    const member = await createProduct({ saleOnly: true, salePrice: 9000, children: 1 })
    await linkBundle(pkg.parentId, member.parentId)
    const first = await tryHold(pkg.parentId, range())
    expect(first.success).toBe(true)
    const second = await tryHold(pkg.parentId, range()) // 겹치지 않는 다른 기간
    expect(second.success).toBe(false)
    expect(second.error_message).toMatch(/구성품 재고가 부족/)
  })

  it('B2 일반(대여) 결합 구성품은 기존대로 날짜가 다르면 재사용된다(회귀 없음)', async () => {
    const pkg = await createProduct({ saleOnly: false, children: 2 })
    const member = await createProduct({ saleOnly: false, children: 1 })
    await linkBundle(pkg.parentId, member.parentId)
    expect((await tryHold(pkg.parentId, range())).success).toBe(true)
    expect((await tryHold(pkg.parentId, range())).success).toBe(true)
  })

  it('B3 패키지 확정 → 판매 구성품 유닛 비활성(마커), 취소 → 복원 / 금액에는 구성품 요금이 섞이지 않는다', async () => {
    const pkg = await createProduct({ saleOnly: false, children: 1 })
    const member = await createProduct({ saleOnly: true, salePrice: 9000, children: 2 })
    await linkBundle(pkg.parentId, member.parentId)
    const rid = await hold(pkg.parentId, range(3))
    const before = await lineAmount(rid)
    expect(await activeChildren(member.parentId)).toBe(2)
    expect((await setStatus(rid, 'confirmed')).ok).toBe(true)
    expect(await activeChildren(member.parentId)).toBe(1)
    const marked = (await Promise.all(member.childIds.map(marker))).filter((m) => m === rid).length
    expect(marked).toBe(1)
    const after = await lineAmount(rid)
    expect(after).toEqual(before) // 결합상품 판매금액은 청구 금액에 포함되지 않는다
    expect((await setStatus(rid, 'cancelled')).ok).toBe(true)
    expect(await activeChildren(member.parentId)).toBe(2)
  })

  it('B4 판매 구성품이 결합으로 배정된 유닛은 같은 상품의 구매 신청(본상품)이 가져가지 못한다', async () => {
    const pkg = await createProduct({ saleOnly: false, children: 1 })
    const member = await createProduct({ saleOnly: true, salePrice: 9000, children: 1 })
    await linkBundle(pkg.parentId, member.parentId)
    await hold(pkg.parentId, range()) // member의 유일한 유닛이 결합으로 배정됨(미래 날짜)
    const purchase = await tryHold(member.parentId, range()) // 구매는 다른 날짜
    expect(purchase.success).toBe(false)
  })
})
