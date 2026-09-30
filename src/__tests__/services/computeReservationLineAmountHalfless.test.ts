/**
 * TDD: compute_reservation_line_amount — 12시간 요금 미등록 상품 24시간 단위 올림 + 삭제/비활성 요금 제외
 * (Migration 584, 2026-09-30, Stephen 확정)
 *
 * 정책: ① 12h 요금이 없으면 12시간 블록을 만들 수 없으므로 총 대여시간을 24시간 단위로 올림해
 * 일수×24h요금으로 청구(25시간 → 2일). ② 삭제·비활성(is_active=false / deleted_at 있음) 요금은
 * 없는 요금으로 취급. 12h 요금이 있는 상품의 기존 산식은 무변경(회귀 테스트 포함).
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트 — 전용 임시 상품·임시 사용자를 만들고 종료 시 삭제해
 * 다른 테스트가 공유하는 픽스처 상품 데이터를 건드리지 않는다.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

const DAILY = 100000
const HALF = 60000

async function makeProduct(
  rules: { duration_type: '12h' | '24h'; price: number; deleted?: boolean }[],
  opts: { parentId?: string; saleOnly?: boolean; salePrice?: number } = {},
): Promise<string> {
  const tag = `tdd-halfless-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { data, error } = await admin
    .from('products')
    .insert({
      name: tag, category: 'TDD', slug: tag, is_active: false,
      ...(opts.parentId ? { parent_product_id: opts.parentId } : {}),
      ...(opts.saleOnly ? { sale_only: true, sale_price: opts.salePrice ?? 0 } : {}),
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`임시 상품 생성 실패: ${error?.message}`)
  const productId = data.id as string
  cleanups.push(async () => {
    await admin.from('price_rules').delete().eq('product_id', productId)
    await admin.from('products').delete().eq('id', productId)
  })
  for (const r of rules) {
    const { error: e } = await admin.from('price_rules').insert({
      product_id: productId,
      duration_type: r.duration_type,
      price: r.price,
      is_active: !r.deleted,
      deleted_at: r.deleted ? new Date().toISOString() : null,
    })
    if (e) throw new Error(`price_rules 생성 실패: ${e.message}`)
  }
  return productId
}

async function makeLink(mainId: string, optionId: string, o: { isFree: boolean; deleted?: boolean }): Promise<void> {
  const { error } = await admin.from('product_option_links').insert({
    product_id: mainId,
    option_product_id: optionId,
    is_free: o.isFree,
    deleted_at: o.deleted ? new Date().toISOString() : null,
  })
  if (error) throw new Error(`product_option_links 생성 실패: ${error.message}`)
  cleanups.push(async () => {
    await admin.from('product_option_links').delete().eq('product_id', mainId).eq('option_product_id', optionId)
  })
}

async function makeUser(): Promise<string> {
  const email = `tdd-halfless-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !data.user) throw new Error(`임시 사용자 생성 실패: ${error?.message}`)
  const id = data.user.id
  cleanups.push(async () => { await admin.auth.admin.deleteUser(id) })
  return id
}

async function amountFull(
  productId: string,
  o: { start: string; end: string; pickup: string; ret: string; method?: string },
  option?: { optionProductId: string; unitPrice: number; qty: number },
) {
  const userId = await makeUser()
  const { data, error } = await admin
    .from('rental_reservations')
    .insert({
      product_id: productId,
      user_id: userId,
      start_date: o.start,
      end_date: o.end,
      pickup_time: o.pickup,
      return_time: o.ret,
      pickup_method: o.method ?? 'visit',
      status: 'hold',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`임시 예약 생성 실패: ${error?.message}`)
  const rid = data.id as number
  cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', rid) })
  if (option) {
    const { error: oe } = await admin.from('reservation_options').insert({
      reservation_id: rid,
      option_product_id: option.optionProductId,
      option_name: 'TDD 옵션',
      qty: option.qty,
      unit_price: option.unitPrice,
    })
    if (oe) throw new Error(`reservation_options 생성 실패: ${oe.message}`)
  }
  const { data: fee, error: e2 } = await admin.rpc('compute_reservation_line_amount', { p_reservation_id: rid })
  // 같은 상품의 기간 겹침 배제 제약(rental_reservations_product_dates_excl) 때문에 계산 직후 즉시 삭제
  await admin.from('reservation_options').delete().eq('reservation_id', rid)
  await admin.from('rental_reservations').delete().eq('id', rid)
  if (e2) throw new Error(`compute_reservation_line_amount 실패: ${e2.message}`)
  const row = (Array.isArray(fee) ? fee[0] : fee) as { rental_fee: number; options_fee: number }
  return { rental: Number(row.rental_fee), options: Number(row.options_fee) }
}

async function amount(
  productId: string,
  o: { start: string; end: string; pickup: string; ret: string; method?: string },
) {
  return (await amountFull(productId, o)).rental
}

describe('[TDD] compute_reservation_line_amount — 12h 요금 없음 → 24시간 단위 올림 (Migration 584)', () => {
  it('SV-1: 24h만 있는 상품, 당일 9시간 → 1일 요금 (기존엔 0원)', async () => {
    const pid = await makeProduct([{ duration_type: '24h', price: DAILY }])
    expect(await amount(pid, { start: '2030-03-04', end: '2030-03-04', pickup: '10:00', ret: '19:00' })).toBe(DAILY)
  })

  it('SV-2: 24h만 있는 상품, 25시간 → 2일 요금 (기존엔 1일만 청구)', async () => {
    const pid = await makeProduct([{ duration_type: '24h', price: DAILY }])
    expect(await amount(pid, { start: '2030-03-04', end: '2030-03-05', pickup: '10:00', ret: '11:00' })).toBe(DAILY * 2)
  })

  it('SV-3: 24h만 있는 상품, 정확히 24시간 → 1일 / 48시간 → 2일 / 49시간 → 3일', async () => {
    const pid = await makeProduct([{ duration_type: '24h', price: DAILY }])
    expect(await amount(pid, { start: '2030-03-04', end: '2030-03-05', pickup: '10:00', ret: '10:00' })).toBe(DAILY)
    expect(await amount(pid, { start: '2030-03-04', end: '2030-03-06', pickup: '10:00', ret: '10:00' })).toBe(DAILY * 2)
    expect(await amount(pid, { start: '2030-03-04', end: '2030-03-06', pickup: '10:00', ret: '11:00' })).toBe(DAILY * 3)
  })

  it('SV-4 [회귀]: 12h 요금이 있는 상품은 기존 12시간 블록 산식 그대로(9h→half, 25h→daily+half)', async () => {
    const pid = await makeProduct([{ duration_type: '24h', price: DAILY }, { duration_type: '12h', price: HALF }])
    expect(await amount(pid, { start: '2030-03-04', end: '2030-03-04', pickup: '10:00', ret: '19:00' })).toBe(HALF)
    expect(await amount(pid, { start: '2030-03-04', end: '2030-03-05', pickup: '10:00', ret: '11:00' })).toBe(DAILY + HALF)
  })

  it('SV-5: 12h 요금이 삭제(soft-delete)된 상품은 12h 없음과 동일 — 삭제된 옛 요금으로 청구하지 않는다', async () => {
    const pid = await makeProduct([{ duration_type: '24h', price: DAILY }, { duration_type: '12h', price: HALF, deleted: true }])
    expect(await amount(pid, { start: '2030-03-04', end: '2030-03-05', pickup: '10:00', ret: '11:00' })).toBe(DAILY * 2)
  })

  it('SV-6: 24h 요금이 없으면 0원(추정값 없음)', async () => {
    const pid = await makeProduct([{ duration_type: '12h', price: HALF }])
    expect(await amount(pid, { start: '2030-03-04', end: '2030-03-05', pickup: '10:00', ret: '11:00' })).toBe(0)
  })

  it('SV-7: 12h 없는 상품 + 배송 수령(is_delivery_type) → 기존과 동일하게 (날짜차+1)일, 시각 무시', async () => {
    const pid = await makeProduct([{ duration_type: '24h', price: DAILY }])
    // crazydelivery: Stage에서 is_delivery_type=true인 배송 방식(다른 라이브 테스트와 동일 가정)
    // 반납 09:00 = 23시간 — 올림 규칙이면 1일이지만 배송 잠금은 시각을 무시하고 (날짜차+1)=2일이라
    // 두 규칙이 서로 다른 값을 내므로 이 테스트가 배송 잠금 분기를 실제로 구분한다(QA M-4).
    expect(await amount(pid, { start: '2030-03-04', end: '2030-03-05', pickup: '10:00', ret: '09:00', method: 'crazydelivery' })).toBe(DAILY * 2)
    // 대조: 같은 시각을 방문 수령으로 계산하면 올림 1일
    expect(await amount(pid, { start: '2030-03-04', end: '2030-03-05', pickup: '10:00', ret: '09:00', method: 'visit' })).toBe(DAILY)
  })

  it('SV-8: 12h 없는 본상품 + 옵션(자체 12h 있음, qty 2) → 옵션도 본상품의 올림 일수를 따른다(25h → 2일)', async () => {
    const main = await makeProduct([{ duration_type: '24h', price: DAILY }])
    const optionProduct = await makeProduct([{ duration_type: '24h', price: 10000 }, { duration_type: '12h', price: 6000 }])
    const r = await amountFull(
      main,
      { start: '2030-03-04', end: '2030-03-05', pickup: '10:00', ret: '11:00' },
      { optionProductId: optionProduct, unitPrice: 10000, qty: 2 },
    )
    expect(r.rental).toBe(DAILY * 2)
    // 옵션: qty × (올림 일수 2 × unit_price 10000) — 옵션 12h(6000) 반나절 가산 없음(본상품과 동일 일수)
    expect(r.options).toBe(2 * 2 * 10000)
  })

  it('SV-9 [회귀]: 12h 있는 본상품 + 동일 옵션 → 기존대로 25h = 1일 + 반나절(옵션도 12h 가산)', async () => {
    const main = await makeProduct([{ duration_type: '24h', price: DAILY }, { duration_type: '12h', price: HALF }])
    const optionProduct = await makeProduct([{ duration_type: '24h', price: 10000 }, { duration_type: '12h', price: 6000 }])
    const r = await amountFull(
      main,
      { start: '2030-03-04', end: '2030-03-05', pickup: '10:00', ret: '11:00' },
      { optionProductId: optionProduct, unitPrice: 10000, qty: 2 },
    )
    expect(r.rental).toBe(DAILY + HALF)
    expect(r.options).toBe(2 * (1 * 10000 + 6000))
  })

})

/**
 * Migration 585 — 무료(is_free) 옵션: 본상품 범위 한정, 대여방식·기간·시간과 무관하게 무조건 0원
 * 정책(Stephen 확정): ① 무료 옵션은 어떤 대여방식·기간·시간이어도 옵션요금·휴무일 가산 0원.
 * ② 무료 판정은 "그 본상품의 링크"에서만 — 같은 옵션 상품이 다른 본상품에서 유료면 그쪽은 영향 없음.
 */
describe('[TDD] compute_reservation_line_amount — 무료 옵션 (Migration 585)', () => {
  const OPT_UNIT = 10000
  const OPT_HALF = 6000
  const R25 = { start: '2030-03-04', end: '2030-03-05', pickup: '10:00', ret: '11:00' } // 25시간 → 반나절 블록 발생

  async function mainWithHalf() {
    return makeProduct([{ duration_type: '24h', price: DAILY }, { duration_type: '12h', price: HALF }])
  }
  async function optionProduct() {
    return makeProduct([{ duration_type: '24h', price: OPT_UNIT }, { duration_type: '12h', price: OPT_HALF }])
  }

  it('F-1: 무료 링크 + 옵션 12h 있음 + 25시간(반나절 블록) → 옵션요금 0 (기존엔 12h 정가 청구)', async () => {
    const main = await mainWithHalf()
    const opt = await optionProduct()
    await makeLink(main, opt, { isFree: true })
    const r = await amountFull(main, R25, { optionProductId: opt, unitPrice: 0, qty: 2 })
    expect(r.rental).toBe(DAILY + HALF)
    expect(r.options).toBe(0)
  })

  it('F-2 [본상품 범위]: 같은 옵션이 본상품 A에선 무료, B에선 유료 → B 예약은 기존 계산 그대로(무료 영향 없음)', async () => {
    const mainA = await mainWithHalf()
    const mainB = await mainWithHalf()
    const opt = await optionProduct()
    await makeLink(mainA, opt, { isFree: true })
    await makeLink(mainB, opt, { isFree: false })
    const a = await amountFull(mainA, R25, { optionProductId: opt, unitPrice: 0, qty: 1 })
    const b = await amountFull(mainB, R25, { optionProductId: opt, unitPrice: OPT_UNIT, qty: 1 })
    expect(a.options).toBe(0)
    expect(b.options).toBe(1 * (1 * OPT_UNIT + OPT_HALF))
  })

  it('F-3 [본상품 범위]: 무료 링크가 없는 다른 본상품(링크 자체 없음)은 영향 없음', async () => {
    const mainA = await mainWithHalf()
    const mainB = await mainWithHalf()
    const opt = await optionProduct()
    await makeLink(mainA, opt, { isFree: true })
    const b = await amountFull(mainB, R25, { optionProductId: opt, unitPrice: OPT_UNIT, qty: 1 })
    expect(b.options).toBe(OPT_UNIT + OPT_HALF)
  })

  it('F-4 [대여방식 무관]: 무료 + 배송 수령(배송 잠금, 3일) → 0', async () => {
    const main = await mainWithHalf()
    const opt = await optionProduct()
    await makeLink(main, opt, { isFree: true })
    const r = await amountFull(main, { start: '2030-03-04', end: '2030-03-06', pickup: '10:00', ret: '10:00', method: 'crazydelivery' }, { optionProductId: opt, unitPrice: OPT_UNIT, qty: 3 })
    expect(r.options).toBe(0)
  })

  it('F-5 [기간·시간 무관]: 무료 + 당일 9시간 / 다일 49시간 모두 0', async () => {
    const main = await mainWithHalf()
    const opt = await optionProduct()
    await makeLink(main, opt, { isFree: true })
    const same = await amountFull(main, { start: '2030-03-04', end: '2030-03-04', pickup: '10:00', ret: '19:00' }, { optionProductId: opt, unitPrice: 0, qty: 1 })
    const multi = await amountFull(main, { start: '2030-03-04', end: '2030-03-06', pickup: '10:00', ret: '11:00' }, { optionProductId: opt, unitPrice: 0, qty: 1 })
    expect(same.options).toBe(0)
    expect(multi.options).toBe(0)
  })

  it('F-6 [무조건 0]: 저장된 unit_price가 0이 아니어도(예: 무료 설정 전 저장분) 무료 링크면 0', async () => {
    const main = await mainWithHalf()
    const opt = await optionProduct()
    await makeLink(main, opt, { isFree: true })
    const r = await amountFull(main, R25, { optionProductId: opt, unitPrice: OPT_UNIT, qty: 1 })
    expect(r.options).toBe(0)
  })

  it('F-7: 12h 없는 본상품(올림 일수) + 무료 옵션 → 0', async () => {
    const main = await makeProduct([{ duration_type: '24h', price: DAILY }])
    const opt = await optionProduct()
    await makeLink(main, opt, { isFree: true })
    const r = await amountFull(main, R25, { optionProductId: opt, unitPrice: OPT_UNIT, qty: 1 })
    expect(r.rental).toBe(DAILY * 2)
    expect(r.options).toBe(0)
  })

  it('F-8 [자식 예약]: 예약 상품이 재고(자식)여도 부모의 무료 링크가 적용된다', async () => {
    const parent = await mainWithHalf()
    const child = await makeProduct(
      [{ duration_type: '24h', price: DAILY }, { duration_type: '12h', price: HALF }],
      { parentId: parent },
    )
    const opt = await optionProduct()
    await makeLink(parent, opt, { isFree: true })
    const r = await amountFull(child, R25, { optionProductId: opt, unitPrice: 0, qty: 1 })
    expect(r.options).toBe(0)
  })

  it('F-9 [회귀]: 링크가 삭제(deleted_at)된 무료 설정은 무료로 보지 않는다', async () => {
    const main = await mainWithHalf()
    const opt = await optionProduct()
    await makeLink(main, opt, { isFree: true, deleted: true })
    const r = await amountFull(main, R25, { optionProductId: opt, unitPrice: OPT_UNIT, qty: 1 })
    expect(r.options).toBe(OPT_UNIT + OPT_HALF)
  })

  it('F-10 [회귀]: 무료 아닌 링크(is_free=false)는 기존 계산 그대로', async () => {
    const main = await mainWithHalf()
    const opt = await optionProduct()
    await makeLink(main, opt, { isFree: false })
    const r = await amountFull(main, R25, { optionProductId: opt, unitPrice: OPT_UNIT, qty: 2 })
    expect(r.options).toBe(2 * (OPT_UNIT + OPT_HALF))
  })

  it('F-11 [판매전용 본상품]: 무료 옵션은 0, 유료 옵션은 기존대로 unit_price×qty', async () => {
    const main = await makeProduct([], { saleOnly: true, salePrice: 50000 })
    const freeOpt = await optionProduct()
    const paidOpt = await optionProduct()
    await makeLink(main, freeOpt, { isFree: true })
    await makeLink(main, paidOpt, { isFree: false })
    const free = await amountFull(main, R25, { optionProductId: freeOpt, unitPrice: OPT_UNIT, qty: 2 })
    const paid = await amountFull(main, R25, { optionProductId: paidOpt, unitPrice: OPT_UNIT, qty: 2 })
    expect(free.rental).toBe(50000)
    expect(free.options).toBe(0)
    expect(paid.options).toBe(OPT_UNIT * 2)
  })
})
