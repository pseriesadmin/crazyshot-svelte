/**
 * TDD-RED: editOrderApiOnlyDb.test.ts
 * Migration 814 — 예약 수정 저장 함수 API 전용(service_role 전용) 잠금. Stage(ezyvffjvuwmtuhpxdjrw) 라이브 시험.
 * ⚠️ 마이그레이션 #814 가 Stage 에 적용되기 전에는 RED 가 정상이다.
 *
 * B-START
 *  - 정상: service_role 이 for_user 함수로 본인 주문을 수정(예약 품번 유지).
 *  - 막을 것: anon·authenticated 의 for_user·5인자 편집 함수 직접 호출 / 다른 사용자 id 로 남의 주문 수정 / p_user_id 없이 호출 / 호출 뒤 사용자 claim 잔류.
 *  - 실패 시: 권한 오류 또는 success=false + 사유 코드(NOT_OWNER·UNAUTHENTICATED), 원본 불변.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'
import { approveTestCustomer } from '../helpers/approveTestCustomer'
import { ensure24hPriceRule } from '../helpers/ensure24hPriceRule'

// 시간 제한 보정: Stage 라이브 호출(사용자 생성·로그인·여러 RPC)이 많아 승계 등 느린 시험이 기본 5000ms 를 넘는다.
vi.setConfig({ testTimeout: 60000 })

// ⛔ Production 오접속 가드 — 이 시험은 사용자·상품·예약을 만들고 지우는 라이브 시험이다. Production 이면 DB 에 접근하기 전에 즉시 중단한다.
if (PUBLIC_SUPABASE_URL.includes('vnbpmvxruyciuuaermyh')) {
  throw new Error('Production DB(vnbpmvxruyciuuaermyh) 에 연결된 환경입니다 — 이 시험은 Stage(ezyvffjvuwmtuhpxdjrw) 전용이라 실행하지 않습니다. .env.local 의 PUBLIC_SUPABASE_URL 을 확인하세요.')
}

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
const FN = 'edit_submitted_reservation_order'
const FN_USER = 'edit_submitted_reservation_order_for_user'

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
}, 120000)

// 날짜 겹침 방지: 파일 전체에서 서로 다른 슬롯을 쓴다
const slotBase = Date.now() % 1000
let slotCounter = 0
function nextRange(days = 2): { start: string; end: string } {
  slotCounter += 1
  const start = new Date(Date.UTC(2041, 0, 1) + (slotBase * 60 + slotCounter) * 7 * 86400000)
  const end = new Date(start.getTime() + days * 86400000)
  const f = (d: Date) => d.toISOString().slice(0, 10)
  return { start: f(start), end: f(end) }
}

interface Session { client: SupabaseClient; userId: string }
async function createUser(): Promise<Session> {
  const email = `tdd-edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const password = 'Test1234!'
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw new Error(`시험 사용자 생성 실패: ${error?.message}`)
  const userId = data.user.id
  await approveTestCustomer(admin, userId)
  const client = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw new Error(`시험 사용자 로그인 실패: ${signInError.message}`)
  cleanups.push(async () => {
    const { data: res } = await admin.from('rental_reservations').select('id').eq('user_id', userId)
    const ids = ((res ?? []) as Array<{ id: number }>).map(r => r.id)
    if (ids.length > 0) {
      await admin.from('payment_transactions').delete().in('reservation_id', ids)
      await admin.from('reservation_options').delete().in('reservation_id', ids)
      const { data: cs } = await admin.from('contracts').select('id').in('reservation_id', ids)
      const cids = ((cs ?? []) as Array<{ id: string }>).map(c => c.id)
      if (cids.length > 0) {
        await admin.from('contract_signings').delete().in('contract_id', cids)
        await admin.from('contracts').delete().in('id', cids)
      }
      const { data: ois } = await admin.from('order_items').select('order_id').in('reservation_id', ids)
      const oids = [...new Set(((ois ?? []) as Array<{ order_id: number }>).map(o => o.order_id))]
      await admin.from('order_items').delete().in('reservation_id', ids)
      if (oids.length > 0) {
        await admin.from('order_coupons').delete().in('order_id', oids)
        await admin.from('orders').delete().in('id', oids)
      }
      await admin.from('rental_reservations').delete().in('id', ids)
    }
    await admin.auth.admin.deleteUser(userId)
  })
  return { client, userId }
}

/**
 * 부모 상품 1 + 활성 자식 childCount + 24h 요금(부모·자식). 부모 id 반환
 * withPrice=false 면 요금을 만들지 않는다(PRICE_UNSET 시험). saleOnly=true 면 판매전용 상품.
 * 상품 정리는 사용자·예약 정리가 끝난 뒤(맨 마지막)에 돌도록 cleanups 맨 앞에 넣는다(FK 때문에 상품을 먼저 지우면 실패).
 */
async function createProduct(label: string, childCount = 1, opts: { withPrice?: boolean; saleOnly?: boolean } = {}): Promise<string> {
  const withPrice = opts.withPrice ?? true
  const { data: parent, error } = await admin
    .from('products')
    .insert({ name: `[TDD-EDIT] ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, category: 'other', is_active: true, ...(opts.saleOnly ? { sale_only: true, sale_price: 10000 } : {}) })
    .select('id')
    .single()
  if (error || !parent) throw new Error(`부모상품 생성 실패: ${error?.message}`)
  const parentId = (parent as { id: string }).id
  const childIds: string[] = []
  for (let i = 0; i < childCount; i++) {
    const { data: child, error: cErr } = await admin
      .from('products')
      .insert({ name: `[TDD-EDIT] ${label} 자식${i}`, category: 'other', is_active: true, parent_product_id: parentId })
      .select('id')
      .single()
    if (cErr || !child) throw new Error(`자식상품 생성 실패: ${cErr?.message}`)
    childIds.push((child as { id: string }).id)
  }
  cleanups.unshift(async () => {
    await admin.from('product_option_links').delete().or(`product_id.eq.${parentId},option_product_id.eq.${parentId}`)
    await admin.from('products').delete().eq('parent_product_id', parentId)
    await admin.from('products').delete().eq('id', parentId)
  })
  if (withPrice) {
    await ensure24hPriceRule(admin, parentId)
    for (const id of childIds) await ensure24hPriceRule(admin, id)
  }
  return parentId
}

interface Submitted { ids: number[]; orderId: number; code: string; start: string; end: string }
/** 사용자 세션으로 hold 를 만들고 주문으로 묶는다(= 제출된 신청대기 예약) */
async function submit(s: Session, productIds: string[], range = nextRange()): Promise<Submitted> {
  const ids: number[] = []
  for (const productId of productIds) {
    const { data, error } = await s.client.rpc('create_hold_reservation', {
      p_product_id: productId, p_start_date: range.start, p_end_date: range.end, p_pickup_method: 'visit', p_return_method: 'visit',
    })
    const row = (data as Array<{ success: boolean; reservation_id: number | null; error_message: string | null }> | null)?.[0]
    if (error || !row?.success || row.reservation_id == null) throw new Error(`hold 생성 실패: ${error?.message ?? row?.error_message}`)
    ids.push(row.reservation_id)
  }
  const { data: order, error: oErr } = await admin.rpc('create_reservation_order', { p_user_id: s.userId, p_reservation_ids: ids })
  const o = (order as Array<{ order_id: number }> | null)?.[0]
  if (oErr || !o) throw new Error(`주문 연결 실패: ${oErr?.message}`)
  const { data: code } = await admin.from('rental_reservations').select('reservation_code').eq('id', ids[0]).single()
  return { ids, orderId: o.order_id, code: (code as { reservation_code: string }).reservation_code, ...range }
}

interface Line {
  keep?: boolean; reservation_id?: number; product_id?: string; start_date?: string; end_date?: string; pickup_method?: string; return_method?: string
  pickup_time?: string; return_time?: string; duration_type?: string; frontdoor_password?: string
  options?: Array<{ option_product_id: string; option_name?: string; qty: number; unit_price?: number }>
}
const newLine = (productId: string, r: { start: string; end: string }): Line => ({
  product_id: productId, start_date: r.start, end_date: r.end, pickup_method: 'visit', return_method: 'visit', pickup_time: '10:00', return_time: '18:00', duration_type: '24h',
})
const keepLine = (id: number): Line => ({ keep: true, reservation_id: id })

interface EditResult {
  success: boolean; reason: string; message?: string; order_id?: number; reservation_ids?: number[]; reservation_code?: string
  final_amount?: number; previous_final_amount?: number; dropped_coupons?: Array<{ userCouponId: string; reason: string }>
  selected_points?: number; delivery_fee?: number; total_amount?: number; cancelled_reservation_ids?: number[]
}
async function statusOf(id: number): Promise<string> {
  const { data } = await admin.from('rental_reservations').select('status').eq('id', id).single()
  return (data as { status: string }).status
}
async function orderItemIds(orderId: number): Promise<number[]> {
  const { data } = await admin.from('order_items').select('reservation_id').eq('order_id', orderId)
  return ((data ?? []) as Array<{ reservation_id: number }>).map(r => r.reservation_id).sort((a, b) => a - b)
}
const isPermissionError = (e: { code?: string; message: string } | null): boolean =>
  !!e && (e.code === '42501' || /permission denied|not allowed|must be owner/i.test(e.message))

describe('[TDD] 814 권한 — API 전용', () => {
  it('anon·authenticated 는 for_user 와 5인자 편집 함수를 직접 호출할 수 없다', async () => {
    const s = await createUser()
    const p = await createProduct('권한')
    const sub = await submit(s, [p])
    const userArgs = { p_user_id: s.userId, p_reservation_id: sub.ids[0], p_expected_reservation_ids: sub.ids, p_lines: [keepLine(sub.ids[0])] }
    const fiveArgs = { p_reservation_id: sub.ids[0], p_expected_reservation_ids: sub.ids, p_lines: [keepLine(sub.ids[0])] }
    for (const c of [anon, s.client]) {
      const a = await c.rpc(FN_USER, userArgs)
      expect(isPermissionError(a.error), `for_user: ${a.error?.message}`).toBe(true)
      const b = await c.rpc(FN, fiveArgs)
      expect(isPermissionError(b.error), `5인자: ${b.error?.message}`).toBe(true)
    }
    expect(await statusOf(sub.ids[0])).toBe('hold')
  })

  it('service_role 은 for_user 로 본인 주문을 수정한다 — 예약 품번 유지', async () => {
    const s = await createUser()
    const p1 = await createProduct('서비스A')
    const p2 = await createProduct('서비스B')
    const sub = await submit(s, [p1])
    const r = nextRange(3)
    const { data, error } = await admin.rpc(FN_USER, {
      p_user_id: s.userId, p_reservation_id: sub.ids[0], p_expected_reservation_ids: sub.ids, p_lines: [newLine(p2, r)],
    })
    expect(error, `${error?.code} ${error?.message}`).toBeNull()
    const res = data as EditResult
    expect(res).toMatchObject({ success: true, reason: 'ok' })
    expect(res.reservation_code).toBe(sub.code)
    expect(await statusOf(sub.ids[0])).toBe('cancelled')
  })

  it('다른 사용자 id 를 p_user_id 로 주면 NOT_OWNER 이고 원본은 그대로다', async () => {
    const owner = await createUser()
    const other = await createUser()
    const p = await createProduct('타인id')
    const sub = await submit(owner, [p])
    const { data, error } = await admin.rpc(FN_USER, {
      p_user_id: other.userId, p_reservation_id: sub.ids[0], p_expected_reservation_ids: sub.ids, p_lines: [newLine(p, nextRange(3))],
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ success: false, reason: 'NOT_OWNER' })
    expect(await statusOf(sub.ids[0])).toBe('hold')
    expect(await orderItemIds(sub.orderId)).toEqual(sub.ids)
  })

  it('p_user_id 가 NULL 이면 UNAUTHENTICATED', async () => {
    const owner = await createUser()
    const p = await createProduct('널')
    const sub = await submit(owner, [p])
    const { data, error } = await admin.rpc(FN_USER, {
      p_user_id: null, p_reservation_id: sub.ids[0], p_expected_reservation_ids: sub.ids, p_lines: [keepLine(sub.ids[0])],
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ success: false, reason: 'UNAUTHENTICATED' })
    expect(await statusOf(sub.ids[0])).toBe('hold')
  })

  it('호출 뒤 claim 이 남지 않는다 — 같은 service_role 클라이언트로 5인자 함수를 바로 호출하면 권한 오류(NOT_OWNER 같은 성공 응답이 아님)', async () => {
    const s = await createUser()
    const p = await createProduct('잔류')
    const sub = await submit(s, [p])
    await admin.rpc(FN_USER, { p_user_id: s.userId, p_reservation_id: sub.ids[0], p_expected_reservation_ids: sub.ids, p_lines: [keepLine(sub.ids[0])] })
    const { error } = await admin.rpc(FN, { p_reservation_id: sub.ids[0], p_expected_reservation_ids: sub.ids, p_lines: [keepLine(sub.ids[0])] })
    expect(isPermissionError(error), `5인자: ${error?.message}`).toBe(true)
  })
})
