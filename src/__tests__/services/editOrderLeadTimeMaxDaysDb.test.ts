/**
 * TDD-RED: editOrderLeadTimeMaxDaysDb.test.ts
 * Migration 817 — 예약 수정 저장 함수가 수령 신청 마감(방식별 리드타임)·최대 대여일을 서버에서 집행. Stage(ezyvffjvuwmtuhpxdjrw) 라이브 시험.
 * ⚠️ 마이그레이션 #817 이 Stage 에 적용되기 전에는 RED 가 정상이다(적용 전에는 위반 사유가 HOLD_FAILED/ERROR 로 나온다).
 *
 * B-START
 *  - 정상: 새 줄의 수령일이 방식별 최소 수령일 이상이고 대여 기간이 최대 대여일 이내면 저장된다.
 *  - 막을 것: 마감이 지난 수령일(최소 수령일 하루 전) / 최대 대여일 초과 — 새 줄만 검사, 유지(keep) 줄은 검사하지 않는다.
 *  - 실패 시: success=false + reason PICKUP_LEAD_TIME / RENTAL_PERIOD_EXCEEDED, 원본 예약·주문 항목 불변.
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

// ── 시험 보조 ──────────────────────────────────────────────
const addDays = (iso: string, n: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const kstNow = (): Date => new Date(Date.now() + 9 * 3600e3)

interface MethodRule { key: string; isDelivery: boolean; leadDays: number; cutoffHour: number }
/** 활성 방식 전부의 실제 규칙(서버 get_pickup_lead_rule — CMS 설정 그대로) */
async function activeMethodRules(): Promise<MethodRule[]> {
  const { data: opts } = await admin.from('rental_method_options').select('method_key, display_order').eq('is_active', true).is('deleted_at', null).order('display_order')
  const keys = [...new Set(((opts ?? []) as Array<{ method_key: string }>).map(o => o.method_key).filter(Boolean))]
  const out: MethodRule[] = []
  for (const key of keys) {
    const { data } = await admin.rpc('get_pickup_lead_rule', { p_method_key: key })
    const r = (data as Array<{ lead_days: number; cutoff_hour: number; is_delivery_type: boolean }> | null)?.[0]
    if (r) out.push({ key, isDelivery: r.is_delivery_type, leadDays: r.lead_days, cutoffHour: r.cutoff_hour })
  }
  return out
}
/** 지금(KST) 기준 가장 이른 수령일 = 오늘 + 리드일수 + (현재 시각 < 마감 시각 ? 0 : 1) */
const minPickup = (r: MethodRule): string => {
  const n = kstNow()
  return addDays(n.toISOString().slice(0, 10), r.leadDays + (n.getUTCHours() < r.cutoffHour ? 0 : 1))
}
async function maxRentalDays(): Promise<number> {
  const { data } = await admin.from('rental_shipping_settings').select('max_rental_days').limit(1).single()
  return (data as { max_rental_days: number | null } | null)?.max_rental_days ?? 0
}
const SHOULD_NOT = ['PICKUP_LEAD_TIME', 'RENTAL_PERIOD_EXCEEDED']

/** 방식·날짜를 지정한 새 줄. 반납 방식은 수령 방식과 같게(배송형 수령 → 배송형 반납은 허용 조합) */
function lineFor(productId: string, method: string, start: string, end: string): Line {
  return { product_id: productId, start_date: start, end_date: end, pickup_method: method, return_method: method, pickup_time: '13:00', return_time: '09:00', duration_type: '24h' }
}
async function callUser(s: Session, sub: Submitted, lines: Line[], expected: number[] = sub.ids): Promise<EditResult> {
  const { data, error } = await admin.rpc(FN_USER, { p_user_id: s.userId, p_reservation_id: sub.ids[0], p_expected_reservation_ids: expected, p_lines: lines })
  expect(error, `${error?.code} ${error?.message}`).toBeNull()
  return data as EditResult
}
async function expectUnchanged(sub: Submitted): Promise<void> {
  for (const id of sub.ids) expect(await statusOf(id)).toBe('hold')
  expect(await orderItemIds(sub.orderId)).toEqual(sub.ids)
}

describe('[TDD] 817 수령 신청 마감 — 방식별 리드타임(서버 get_pickup_lead_rule 기준)', () => {
  it('활성 방식마다 최소 수령일은 통과(마감 사유 없음), 하루 전은 PICKUP_LEAD_TIME 으로 거절되고 원본 불변', async () => {
    const rules = await activeMethodRules()
    expect(rules.length).toBeGreaterThan(0)
    const s = await createUser()
    const p = await createProduct('마감')
    for (const rule of rules) {
      const sub = await submit(s, [p], nextRange(2))
      const min = minPickup(rule)

      // 직전(마감 하루 전 수령일) → 거절
      const bad = await callUser(s, sub, [lineFor(p, rule.key, addDays(min, -1), addDays(min, 1))])
      expect(bad, `방식 ${rule.key}`).toMatchObject({ success: false, reason: 'PICKUP_LEAD_TIME' })
      await expectUnchanged(sub)

      // 경계(최소 수령일) → 마감 사유로는 거절되지 않는다
      const ok = await callUser(s, sub, [lineFor(p, rule.key, min, addDays(min, 1))])
      expect(SHOULD_NOT, `방식 ${rule.key}: ${ok.reason}`).not.toContain(ok.reason)
      if (!rule.isDelivery) expect(ok, `방식 ${rule.key}`).toMatchObject({ success: true, reason: 'ok' })
      // 성공했다면 새 예약이 남아 있으므로 다음 방식 시험 전에 정리한다(다음 submit 은 새 주문)
      if (ok.success && ok.reservation_ids) {
        for (const id of ok.reservation_ids) await admin.rpc('update_reservation_status', { p_reservation_id: id, p_new_status: 'cancelled' })
      }
    }
  })

  it('방문 방식: 오늘·어제 수령은 거절, 응답 사유는 HOLD_FAILED 가 아니다', async () => {
    const s = await createUser()
    const p = await createProduct('방문마감')
    const sub = await submit(s, [p])
    const today = kstNow().toISOString().slice(0, 10)
    for (const day of [today, addDays(today, -1)]) {
      const r = await callUser(s, sub, [lineFor(p, 'visit', day, addDays(day, 1))])
      expect(r).toMatchObject({ success: false, reason: 'PICKUP_LEAD_TIME' })
    }
    await expectUnchanged(sub)
  })

  it('교체 줄과 함께 와도 마감 지난 새 줄이 하나라도 있으면 전체 거절(부분 저장 없음)', async () => {
    const s = await createUser()
    const p1 = await createProduct('혼합A')
    const p2 = await createProduct('혼합B')
    const sub = await submit(s, [p1, p2])
    const today = kstNow().toISOString().slice(0, 10)
    const r = await callUser(s, sub, [lineFor(p1, 'visit', nextRange(2).start, nextRange(2).end), lineFor(p2, 'visit', today, addDays(today, 1))])
    expect(r).toMatchObject({ success: false, reason: 'PICKUP_LEAD_TIME' })
    await expectUnchanged(sub)
  })
})

describe('[TDD] 817 최대 대여일 — rental_shipping_settings.max_rental_days', () => {
  it('일반 방식(방문): 차이 max일 통과, max+1일 RENTAL_PERIOD_EXCEEDED', async () => {
    const max = await maxRentalDays()
    expect(max, 'Stage 에 최대 대여일 설정이 있어야 이 시험이 의미가 있다').toBeGreaterThan(0)
    const s = await createUser()
    const p = await createProduct('최대일수')
    const sub = await submit(s, [p])
    const start = nextRange(2).start

    const over = await callUser(s, sub, [lineFor(p, 'visit', start, addDays(start, max + 1))])
    expect(over).toMatchObject({ success: false, reason: 'RENTAL_PERIOD_EXCEEDED' })
    await expectUnchanged(sub)

    const edge = await callUser(s, sub, [lineFor(p, 'visit', start, addDays(start, max))])
    expect(edge).toMatchObject({ success: true, reason: 'ok' })
  })

  it('배송형: 포함 일수(차이+1) 기준 — 차이 max-1 통과, 차이 max 초과', async () => {
    const max = await maxRentalDays()
    const delivery = (await activeMethodRules()).find(r => r.isDelivery)
    if (!delivery) return // Stage 에 배송형 방식이 없으면 해당 없음
    expect(max).toBeGreaterThan(0)
    const s = await createUser()
    const p = await createProduct('배송최대일수')
    const sub = await submit(s, [p])
    const start = nextRange(2).start

    const over = await callUser(s, sub, [lineFor(p, delivery.key, start, addDays(start, max))])
    expect(over).toMatchObject({ success: false, reason: 'RENTAL_PERIOD_EXCEEDED' })
    await expectUnchanged(sub)

    const edge = await callUser(s, sub, [lineFor(p, delivery.key, start, addDays(start, max - 1))])
    expect(SHOULD_NOT, edge.reason).not.toContain(edge.reason)
  })
})

describe('[TDD] 817 유지(keep) 줄은 마감·최대 대여일을 다시 검사하지 않는다', () => {
  it('수령일이 이미 마감을 지난 기존 예약은 keep 으로 두고 다른 줄만 바꿔도 저장된다', async () => {
    const s = await createUser()
    const pKeep = await createProduct('유지')
    const pNew = await createProduct('교체')
    const sub = await submit(s, [pKeep, pNew])
    // 이 예약이 '제출 당시에는 정상이었지만 지금은 마감이 지난' 상태를 만든다(시험 준비용 직접 수정 — 시험 데이터 한정)
    const today = kstNow().toISOString().slice(0, 10)
    const { error: uErr } = await admin.from('rental_reservations').update({ start_date: today, end_date: addDays(today, 2) }).eq('id', sub.ids[0])
    expect(uErr).toBeNull()

    const r = await callUser(s, sub, [keepLine(sub.ids[0]), lineFor(pNew, 'visit', nextRange(2).start, nextRange(2).end)])
    expect(r, `${r.reason} ${r.message ?? ''}`).toMatchObject({ success: true, reason: 'ok' })
    expect(r.reservation_ids).toContain(sub.ids[0])
    expect(await statusOf(sub.ids[0])).toBe('hold')
  })

  it('최대 대여일을 넘긴 기존 예약도 keep 이면 검사하지 않는다', async () => {
    const max = await maxRentalDays()
    expect(max).toBeGreaterThan(0)
    const s = await createUser()
    const pKeep = await createProduct('유지최대')
    const pNew = await createProduct('교체최대')
    const sub = await submit(s, [pKeep, pNew])
    const { error: uErr } = await admin.from('rental_reservations').update({ end_date: addDays(sub.start, max + 5) }).eq('id', sub.ids[0])
    expect(uErr).toBeNull()
    const r = await callUser(s, sub, [keepLine(sub.ids[0]), lineFor(pNew, 'visit', nextRange(2).start, nextRange(2).end)])
    expect(r, `${r.reason} ${r.message ?? ''}`).toMatchObject({ success: true, reason: 'ok' })
  })
})

describe('[TDD] 817 권한은 814 상태 유지', () => {
  it('재정의 뒤에도 authenticated·service_role 은 5인자 함수를 직접 호출할 수 없다', async () => {
    const s = await createUser()
    const p = await createProduct('권한유지')
    const sub = await submit(s, [p])
    const args = { p_reservation_id: sub.ids[0], p_expected_reservation_ids: sub.ids, p_lines: [keepLine(sub.ids[0])] }
    for (const c of [s.client, admin]) {
      const { error } = await c.rpc(FN, args)
      expect(isPermissionError(error), `5인자: ${error?.message}`).toBe(true)
    }
  })
})
