/**
 * followOptionServerCorrection.test.ts
 * 옵션상품 설정의 서버 보정 (Migration #769, 2026-10-26, Stephen 지시)
 *   ① set_reservation_options — "수량 본상품 연동"(qty_follows_main) 옵션은 장바구니 그룹(같은 상품·같은 날짜) 크기로 서버가 수량을 보정한다(재고가 모자라면 min(그룹 크기, 재고)).
 *   ② create_reservation_order — 주문 생성 직전에 연동 옵션 수량을 현재 그룹 크기로 다시 맞춘다(수량 변경이 옵션에 반영되지 않은 낡은 요청 보정).
 *   ③ create_reservation_order — "배송 대여 불가"(delivery_rental_disabled) 옵션이 있는 그룹이 배송형(is_delivery_type) 방식이면 주문을 거절한다.
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트. 모든 fixture는 테스트마다 격리 생성·정리한다.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'
import { approveTestCustomer } from '../helpers/approveTestCustomer'
import { ensure24hPriceRule } from '../helpers/ensure24hPriceRule'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
}, 60000)

const tag = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

async function createSession(): Promise<{ client: SupabaseClient; userId: string }> {
  const email = `tdd-follow-${tag()}@example.com`
  const password = 'Test1234!'
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw new Error(`임시 사용자 생성 실패: ${error?.message}`)
  const userId = data.user.id
  await approveTestCustomer(admin, userId)
  const client = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password })
  if (signInErr) throw new Error(`임시 사용자 로그인 실패: ${signInErr.message}`)
  cleanups.push(async () => {
    await admin.auth.admin.deleteUser(userId)
  })
  return { client, userId }
}

/** 부모 + 활성 자식 childCount개 */
async function makeProduct(label: string, childCount: number): Promise<{ parentId: string; childIds: string[] }> {
  const { data: parent, error } = await admin
    .from('products')
    .insert({ name: `[TDD] ${label} ${tag()}`, category: 'other', is_active: true })
    .select('id')
    .single()
  if (error || !parent) throw new Error(`부모상품 생성 실패: ${error?.message}`)
  const parentId = (parent as { id: string }).id
  cleanups.push(async () => {
    await admin.from('products').delete().eq('parent_product_id', parentId)
    await admin.from('products').delete().eq('id', parentId)
  })
  const childIds: string[] = []
  for (let i = 0; i < childCount; i++) {
    const { data: c, error: ce } = await admin
      .from('products')
      .insert({ name: `[TDD] ${label} 자식${i}`, category: 'other', is_active: true, parent_product_id: parentId })
      .select('id')
      .single()
    if (ce || !c) throw new Error(`자식상품 생성 실패: ${ce?.message}`)
    childIds.push((c as { id: string }).id)
  }
  return { parentId, childIds }
}

async function makeLink(
  mainId: string,
  optionId: string,
  o: { follow?: boolean; required?: boolean; deliveryDisabled?: boolean },
): Promise<void> {
  const { error } = await admin.from('product_option_links').insert({
    product_id: mainId,
    option_product_id: optionId,
    qty_follows_main: o.follow ?? false,
    is_required: o.required ?? false,
    delivery_rental_disabled: o.deliveryDisabled ?? false,
  })
  if (error) throw new Error(`product_option_links 생성 실패: ${error.message}`)
  cleanups.push(async () => {
    await admin.from('product_option_links').delete().eq('product_id', mainId).eq('option_product_id', optionId)
  })
}

type DraftRow = { success: boolean; reservation_id: number | null; error_message: string | null }

/** 같은 상품의 임시예약(draft) n개 — 장바구니에서 같은 카드로 묶이는 그룹(첫 번째가 canonical) */
async function makeDraftGroup(client: SupabaseClient, mainParentId: string, n: number): Promise<number[]> {
  const ids: number[] = []
  for (let i = 0; i < n; i++) {
    const { data, error } = await client.rpc('create_draft_reservation', { p_product_id: mainParentId })
    if (error) throw new Error(`create_draft_reservation 오류: ${error.message}`)
    const row = (data as DraftRow[] | null)?.[0]
    if (!row?.success || row.reservation_id == null) throw new Error(`create_draft_reservation 실패: ${row?.error_message}`)
    const id = row.reservation_id
    ids.push(id)
    cleanups.push(async () => {
      await admin.from('reservation_options').delete().eq('reservation_id', id)
      await admin.from('rental_reservations').delete().eq('id', id)
    })
  }
  return ids.sort((a, b) => a - b)
}

async function saveOptions(
  client: SupabaseClient,
  reservationId: number,
  items: Array<{ id: string; qty: number }>,
): Promise<{ error: { message: string } | null }> {
  const { error } = await client.rpc('set_reservation_options', {
    p_reservation_id: reservationId,
    p_options: items.map((i) => ({ option_product_id: i.id, option_name: '테스트 옵션', qty: i.qty, unit_price: 3000 })),
  })
  return { error: error as { message: string } | null }
}

async function storedQty(reservationId: number, optionId: string): Promise<number | null> {
  const { data } = await admin
    .from('reservation_options')
    .select('qty')
    .eq('reservation_id', reservationId)
    .eq('option_product_id', optionId)
  const rows = (data ?? []) as Array<{ qty: number }>
  return rows.length === 1 ? rows[0].qty : null
}

describe('[TDD] set_reservation_options — 수량 본상품 연동 서버 보정', () => {
  it('FO-1: 연동 옵션(선택, 1 담음) + 같은 상품 3건 그룹 → 3으로 보정 저장', async () => {
    const { client } = await createSession()
    const main = await makeProduct('본상품', 1)
    const opt = await makeProduct('옵션', 5)
    await makeLink(main.parentId, opt.parentId, { follow: true })
    const ids = await makeDraftGroup(client, main.parentId, 3)
    const { error } = await saveOptions(client, ids[0], [{ id: opt.parentId, qty: 1 }])
    expect(error).toBeNull()
    expect(await storedQty(ids[0], opt.parentId)).toBe(3)
  })

  it('FO-2: 재고가 그룹보다 적으면 min(그룹 크기, 재고)', async () => {
    const { client } = await createSession()
    const main = await makeProduct('본상품', 1)
    const opt = await makeProduct('옵션', 2)
    await makeLink(main.parentId, opt.parentId, { follow: true })
    const ids = await makeDraftGroup(client, main.parentId, 3)
    const { error } = await saveOptions(client, ids[0], [{ id: opt.parentId, qty: 1 }])
    expect(error).toBeNull()
    expect(await storedQty(ids[0], opt.parentId)).toBe(2)
  })

  it('FO-3: 연동 옵션인데 가용 재고가 0이면 기존처럼 OPTION_STOCK_EXCEEDED', async () => {
    const { client } = await createSession()
    const main = await makeProduct('본상품', 1)
    const opt = await makeProduct('옵션', 0)
    await makeLink(main.parentId, opt.parentId, { follow: true })
    const ids = await makeDraftGroup(client, main.parentId, 2)
    const { error } = await saveOptions(client, ids[0], [{ id: opt.parentId, qty: 1 }])
    expect(error?.message ?? '').toContain('OPTION_STOCK_EXCEEDED')
  })

  it('FO-4 [회귀]: 연동이 아닌 옵션은 보낸 수량 그대로 (그룹 크기와 무관)', async () => {
    const { client } = await createSession()
    const main = await makeProduct('본상품', 1)
    const opt = await makeProduct('옵션', 5)
    await makeLink(main.parentId, opt.parentId, { follow: false })
    const ids = await makeDraftGroup(client, main.parentId, 3)
    const { error } = await saveOptions(client, ids[0], [{ id: opt.parentId, qty: 1 }])
    expect(error).toBeNull()
    expect(await storedQty(ids[0], opt.parentId)).toBe(1)
  })

  it('FO-5: 필수 연동 옵션은 크게 보내도 그룹 크기로 내려 보정', async () => {
    const { client } = await createSession()
    const main = await makeProduct('본상품', 1)
    const opt = await makeProduct('옵션', 8)
    await makeLink(main.parentId, opt.parentId, { follow: true, required: true })
    const ids = await makeDraftGroup(client, main.parentId, 2)
    const { error } = await saveOptions(client, ids[0], [{ id: opt.parentId, qty: 6 }])
    expect(error).toBeNull()
    expect(await storedQty(ids[0], opt.parentId)).toBe(2)
  })

  it('FO-6 [회귀]: 연동 옵션과 일반 옵션을 함께 저장해도 일반 옵션은 그대로', async () => {
    const { client } = await createSession()
    const main = await makeProduct('본상품', 1)
    const follow = await makeProduct('연동 옵션', 5)
    const plain = await makeProduct('일반 옵션', 5)
    await makeLink(main.parentId, follow.parentId, { follow: true })
    await makeLink(main.parentId, plain.parentId, {})
    const ids = await makeDraftGroup(client, main.parentId, 2)
    const { error } = await saveOptions(client, ids[0], [
      { id: follow.parentId, qty: 1 },
      { id: plain.parentId, qty: 3 },
    ])
    expect(error).toBeNull()
    expect(await storedQty(ids[0], follow.parentId)).toBe(2)
    expect(await storedQty(ids[0], plain.parentId)).toBe(3)
  })
})

// ── create_reservation_order 쪽 ──────────────────────────────────────────────
const D_START = '2031-03-03'
const D_END = '2031-03-04'

/** 본상품 자식 n개를 각각 hold 예약으로 만든다(같은 날짜 = 같은 그룹). 첫 번째가 canonical */
async function makeHoldGroup(userId: string, main: { parentId: string; childIds: string[] }, method: string): Promise<number[]> {
  const ids: number[] = []
  for (const childId of main.childIds) {
    await ensure24hPriceRule(admin, childId)
    // eslint-disable-next-line no-restricted-syntax -- 테스트 픽스처: 같은 날짜·여러 상품의 hold 그룹 행이 필요하고 예약 배정 RPC는 이 검증(옵션 보정·주문 생성 점검)과 무관
    const { data, error } = await admin
      .from('rental_reservations')
      .insert({
        product_id: childId, user_id: userId, start_date: D_START, end_date: D_END,
        pickup_time: '10:00', return_time: '10:00', pickup_method: method, return_method: 'visit',
        duration_type: '24h', status: 'hold',
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`hold 예약 생성 실패: ${error?.message}`)
    const id = (data as { id: number }).id
    ids.push(id)
    cleanups.push(async () => {
      const { data: items } = await admin.from('order_items').select('order_id').eq('reservation_id', id)
      await admin.from('order_items').delete().eq('reservation_id', id)
      for (const it of (items ?? []) as Array<{ order_id: number }>) {
        await admin.from('order_coupons').delete().eq('order_id', it.order_id)
        await admin.from('orders').delete().eq('id', it.order_id)
      }
      await admin.from('reservation_option_assets').delete().eq('reservation_id', id)
      await admin.from('reservation_options').delete().eq('reservation_id', id)
      await admin.from('rental_reservations').delete().eq('id', id)
    })
  }
  return ids.sort((a, b) => a - b)
}

async function putOption(reservationId: number, optionId: string, qty: number): Promise<void> {
  const { error } = await admin
    .from('reservation_options')
    .insert({ reservation_id: reservationId, option_product_id: optionId, option_name: '테스트 옵션', qty, unit_price: 3000 })
  if (error) throw new Error(`reservation_options 직접 저장 실패: ${error.message}`)
}

async function createOrder(userId: string, reservationIds: number[]) {
  return admin.rpc('create_reservation_order', {
    p_user_id: userId,
    p_reservation_ids: reservationIds,
    p_selected_coupon_id: null,
    p_selected_points: 0,
    p_delivery_fee: 0,
  })
}

describe('[TDD] create_reservation_order — 연동 옵션 수량 정규화', () => {
  it('FO-7: 그룹이 3건인데 옵션이 1로 낡아 있으면 주문 생성 때 3으로 맞춘다', async () => {
    const { userId } = await createSession()
    const main = await makeProduct('본상품', 3)
    const opt = await makeProduct('옵션', 5)
    await makeLink(main.parentId, opt.parentId, { follow: true })
    const ids = await makeHoldGroup(userId, main, 'visit')
    await putOption(ids[0], opt.parentId, 1) // 수량 변경이 옵션에 반영되지 않은 낡은 상태
    const { error } = await createOrder(userId, ids)
    expect(error).toBeNull()
    expect(await storedQty(ids[0], opt.parentId)).toBe(3)
  })

  it('FO-8 [회귀]: 연동이 아닌 옵션은 주문 생성이 바꾸지 않는다', async () => {
    const { userId } = await createSession()
    const main = await makeProduct('본상품', 3)
    const opt = await makeProduct('옵션', 5)
    await makeLink(main.parentId, opt.parentId, { follow: false })
    const ids = await makeHoldGroup(userId, main, 'visit')
    await putOption(ids[0], opt.parentId, 1)
    const { error } = await createOrder(userId, ids)
    expect(error).toBeNull()
    expect(await storedQty(ids[0], opt.parentId)).toBe(1)
  })
})

describe('[TDD] create_reservation_order — 배송 대여 불가 옵션 최종 점검', () => {
  it('FO-9: 배송형 방식(crazydelivery) + 배송 대여 불가 옵션이 담긴 그룹이면 OPTION_DELIVERY_DISABLED 로 거절', async () => {
    const { userId } = await createSession()
    const main = await makeProduct('본상품', 2)
    const opt = await makeProduct('옵션', 3)
    await makeLink(main.parentId, opt.parentId, { deliveryDisabled: true })
    const ids = await makeHoldGroup(userId, main, 'crazydelivery')
    await putOption(ids[0], opt.parentId, 1) // 옵션은 canonical 예약에만 있다 — 그룹 전체를 본다
    const { error } = await createOrder(userId, ids)
    expect(error?.message ?? '').toContain('OPTION_DELIVERY_DISABLED')
  })

  it('FO-10 [회귀]: 같은 옵션이어도 방문 방식이면 주문 생성', async () => {
    const { userId } = await createSession()
    const main = await makeProduct('본상품', 2)
    const opt = await makeProduct('옵션', 3)
    await makeLink(main.parentId, opt.parentId, { deliveryDisabled: true })
    const ids = await makeHoldGroup(userId, main, 'visit')
    await putOption(ids[0], opt.parentId, 1)
    const { error } = await createOrder(userId, ids)
    expect(error).toBeNull()
  })

  it('FO-11 [회귀]: 배송형 방식이어도 배송 대여 불가 옵션이 아니면 주문 생성', async () => {
    const { userId } = await createSession()
    const main = await makeProduct('본상품', 2)
    const opt = await makeProduct('옵션', 3)
    await makeLink(main.parentId, opt.parentId, { deliveryDisabled: false })
    const ids = await makeHoldGroup(userId, main, 'crazydelivery')
    await putOption(ids[0], opt.parentId, 1)
    const { error } = await createOrder(userId, ids)
    expect(error).toBeNull()
  })

  it('FO-12 [회귀]: 배송형 방식 + 옵션 없음 → 주문 생성', async () => {
    const { userId } = await createSession()
    const main = await makeProduct('본상품', 1)
    const ids = await makeHoldGroup(userId, main, 'crazydelivery')
    const { error } = await createOrder(userId, ids)
    expect(error).toBeNull()
  })
})

// ── 이미 제출된(주문에 묶인) 형제 예약은 장바구니 그룹이 아니다 (sp3 MAJOR-1, 2026-10-26) ─────────────
describe('[TDD] 그룹 크기·배송 점검은 이미 제출된 형제 예약을 세지 않는다', () => {
  it('FO-13: 같은 상품·같은 날짜로 이미 제출한 2건이 있어도 새로 담은 1건의 연동 옵션은 1로 보정(3이 아님)', async () => {
    const { client, userId } = await createSession()
    const main = await makeProduct('본상품', 3)
    const opt = await makeProduct('옵션', 8)
    await makeLink(main.parentId, opt.parentId, { follow: true })
    const submitted = await makeHoldGroup(userId, { parentId: main.parentId, childIds: main.childIds.slice(0, 2) }, 'visit')
    const first = await createOrder(userId, submitted)
    expect(first.error).toBeNull() // 첫 두 건은 주문에 묶여 "제출됨" 상태가 된다
    const [fresh] = await makeHoldGroup(userId, { parentId: main.parentId, childIds: [main.childIds[2]] }, 'visit')
    const { error } = await saveOptions(client, fresh, [{ id: opt.parentId, qty: 1 }])
    expect(error).toBeNull()
    expect(await storedQty(fresh, opt.parentId)).toBe(1)
  })

  it('FO-14: 제출된 형제 예약의 배송 대여 불가 옵션 때문에 새 배송형 신청이 오탐 거절되지 않는다', async () => {
    const { userId } = await createSession()
    const main = await makeProduct('본상품', 3)
    const opt = await makeProduct('옵션', 3)
    await makeLink(main.parentId, opt.parentId, { deliveryDisabled: true })
    const submitted = await makeHoldGroup(userId, { parentId: main.parentId, childIds: main.childIds.slice(0, 2) }, 'visit')
    await putOption(submitted[0], opt.parentId, 1) // 이미 제출된 방문 신청의 옵션
    expect((await createOrder(userId, submitted)).error).toBeNull()
    const [fresh] = await makeHoldGroup(userId, { parentId: main.parentId, childIds: [main.childIds[2]] }, 'crazydelivery')
    const { error } = await createOrder(userId, [fresh]) // 옵션 없는 새 배송형 신청
    expect(error).toBeNull()
  })

  it('FO-15 [회귀]: 제출 전 같은 그룹 3건이면 여전히 3 (제출된 형제 제외가 정상 그룹을 줄이지 않는다)', async () => {
    const { client, userId } = await createSession()
    const main = await makeProduct('본상품', 3)
    const opt = await makeProduct('옵션', 8)
    await makeLink(main.parentId, opt.parentId, { follow: true })
    const ids = await makeHoldGroup(userId, main, 'visit')
    const { error } = await saveOptions(client, ids[0], [{ id: opt.parentId, qty: 1 }])
    expect(error).toBeNull()
    expect(await storedQty(ids[0], opt.parentId)).toBe(3)
  })
})
