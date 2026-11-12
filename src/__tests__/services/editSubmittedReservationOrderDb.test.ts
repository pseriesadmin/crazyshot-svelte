/**
 * TDD-RED: editSubmittedReservationOrderDb.test.ts
 * 신청대기(hold) 예약 '예약정보 수정' 저장용 DB 편집 함수 (Migration 811, 2026-11-12, Stephen GATE B 승인 E1~E5)
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트. 모든 fixture(상품·사용자·예약·주문·계약)는 이 파일이 직접 만들고
 * afterEach 에서 자기가 만든 행만 정리한다(기존 Stage 데이터는 읽지도 지우지도 않음).
 * ⚠️ 이 파일은 마이그레이션 #811 이 Stage 에 적용된 뒤에야 통과한다(적용 전에는 함수 부재로 RED).
 *
 * B-START
 *  - 정상: 본인 신청대기 주문을 저장 한 번에 수정(상품 추가·삭제·교체, 기간·방식) — 예약 품번(reservation_code)·주문 유지, 재고 해제·재확보, 합계 재계산.
 *  - 막을 것: 서명·결제·취소요청·만료·직접결제 이후 수정 / 타인·익명 호출 / 상품 0개 / 동시 2건 둘 다 성공 / 일부만 반영된 반쪽 상태.
 *  - 실패 시: success=false + 사유 코드, 원본 주문·예약·재고·계약 그대로.
 *
 * 사유 코드(TS reservationEditPolicy.ts 와 동일): ok·SIGNED·PAID·CANCEL_REQUESTED·EXPIRED·DIRECT_PAY·NOT_HOLD·ERROR
 * 편집 함수 추가 코드: UNAUTHENTICATED·NOT_OWNER·STALE·MIN_ONE_LINE·BAD_REQUEST·HOLD_FAILED·SALE_ONLY_NOT_EDITABLE·
 *   DELIVERY_FEE_FAILED·PRICE_UNSET·OPTION_NOT_LINKED
 * S2 2차 재작업 추가 코드: INVALID_METHOD · INVALID_TIME · 소문자 오류 코드의 대문자 매핑(FRONTDOOR_PASSWORD_TOO_LONG 등). 반환에 selected_points·delivery_fee·total_amount·cancelled_reservation_ids 추가.
 *   get_reservation_edit_state(public 읽기 전용 {ok, can_edit, reason}) · 수량 연동 옵션(유지 줄 포함) · 취소 형제 합계 · 구형 단일 쿠폰 · 옵션 중복 합산·단가 없음.
 * S2 재작업(D1~D4): 배송비 인자 제거(서버가 최종 예약 집합으로 재계산 — 배송 시나리오는 deliveryFeeParityDb.test.ts) · 옵션 단가는 서버가 정함 · 서명 전 계약서는 발송 여부와 무관하게 전부 무효 ·
 *   쿠폰 전부 해제/탈락 시 order_coupons 삭제 · 오류 문구 정제(내부 오류 원문 비노출)
 * 테스트로 만들지 않은 항목(필수 컬럼·설정이 많아 불가): 결합상품(product_bundle_links) 구성품 포함 수정, 이미 취소된 형제 order_items 합계(미해결 사항이라 기대값 없음)
 * 권한 확인: has_function_privilege 를 부르는 보조 RPC 가 없어 실제 호출 결과(814 이후: 편집 함수는 service_role 의 for_user 래퍼로만 호출. 직접 호출 차단 시험은 editOrderApiOnlyDb.test.ts)로 같은 사실을 확인한다.
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
const FN = 'edit_submitted_reservation_order_for_user'
// Migration 814: 고객 직접 호출은 회수됨 → 서버(service_role)가 for_user 래퍼로 호출. 클라이언트→사용자 id 매핑.
const clientUserIds = new WeakMap<SupabaseClient, string>()

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
  clientUserIds.set(client, userId)
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
interface EditExtras { p_selected_coupon_ids?: string[]; p_selected_points?: number; [key: string]: unknown }
async function edit(client: SupabaseClient, anchorId: number, expected: number[], lines: Line[], extras: EditExtras = {}): Promise<{ result: EditResult | null; error: { code?: string; message: string } | null }> {
  const { data, error } = await admin.rpc(FN, { p_user_id: clientUserIds.get(client) ?? null, p_reservation_id: anchorId, p_expected_reservation_ids: expected, p_lines: lines, ...extras })
  return { result: (data as EditResult | null) ?? null, error: error as { code?: string; message: string } | null }
}
async function editOk(client: SupabaseClient, anchorId: number, expected: number[], lines: Line[], extras: EditExtras = {}): Promise<EditResult> {
  const { result, error } = await edit(client, anchorId, expected, lines, extras)
  expect(error, `편집 함수 오류: ${error?.code} ${error?.message}`).toBeNull()
  return result as EditResult
}

async function statusOf(id: number): Promise<string> {
  const { data } = await admin.from('rental_reservations').select('status').eq('id', id).single()
  return (data as { status: string }).status
}
async function orderItemIds(orderId: number): Promise<number[]> {
  const { data } = await admin.from('order_items').select('reservation_id').eq('order_id', orderId)
  return ((data ?? []) as Array<{ reservation_id: number }>).map(r => r.reservation_id).sort((a, b) => a - b)
}
async function codesOf(ids: number[]): Promise<string[]> {
  const { data } = await admin.from('rental_reservations').select('reservation_code').in('id', ids)
  return ((data ?? []) as Array<{ reservation_code: string }>).map(r => r.reservation_code)
}
async function orderRow(orderId: number): Promise<{ total_amount: number; final_amount: number }> {
  const { data } = await admin.from('orders').select('total_amount, final_amount').eq('id', orderId).single()
  return data as { total_amount: number; final_amount: number }
}

describe('[TDD] 정상 수정 — 품번·주문 유지', () => {
  it('단일 상품 주문에서 첫 행(대표 예약)을 교체해도 품번·주문이 유지된다', async () => {
    const s = await createUser()
    const p = await createProduct('단일')
    const sub = await submit(s, [p])
    const r2 = nextRange(3)
    const res = await editOk(s.client, sub.ids[0], sub.ids, [newLine(p, r2)])
    expect(res.success).toBe(true)
    expect(res.reason).toBe('ok')
    expect(res.order_id).toBe(sub.orderId)
    expect(res.reservation_code).toBe(sub.code)
    expect(res.reservation_ids).toHaveLength(1)
    expect(res.reservation_ids?.[0]).not.toBe(sub.ids[0])
    expect(await codesOf(res.reservation_ids as number[])).toEqual([sub.code])
    expect(await statusOf(sub.ids[0])).toBe('cancelled')
    expect(await orderItemIds(sub.orderId)).toEqual(res.reservation_ids)
    const { data } = await admin.from('rental_reservations').select('start_date, end_date, status').eq('id', (res.reservation_ids as number[])[0]).single()
    expect(data).toMatchObject({ status: 'hold' })
  })

  it('라인 추가: 유지 줄 + 새 줄 → 주문 항목 2개, 같은 품번, 합계가 늘어난다', async () => {
    const s = await createUser()
    const p1 = await createProduct('추가1')
    const p2 = await createProduct('추가2')
    const sub = await submit(s, [p1])
    const before = await orderRow(sub.orderId)
    const res = await editOk(s.client, sub.ids[0], sub.ids, [keepLine(sub.ids[0]), newLine(p2, sub)])
    expect(res.success).toBe(true)
    expect(res.reservation_ids).toHaveLength(2)
    expect(res.reservation_ids).toContain(sub.ids[0])
    expect(await orderItemIds(sub.orderId)).toEqual(res.reservation_ids)
    expect(new Set(await codesOf(res.reservation_ids as number[]))).toEqual(new Set([sub.code]))
    const after = await orderRow(sub.orderId)
    expect(after.total_amount).toBeGreaterThan(before.total_amount)
    expect(res.previous_final_amount).toBe(before.final_amount)
    expect(res.final_amount).toBe(after.final_amount)
  })

  it('라인 삭제: 한 줄만 남기면 나머지는 취소되고 합계가 줄며 품번 유지', async () => {
    const s = await createUser()
    const p1 = await createProduct('삭제1')
    const p2 = await createProduct('삭제2')
    const sub = await submit(s, [p1, p2])
    const before = await orderRow(sub.orderId)
    const res = await editOk(s.client, sub.ids[1], sub.ids, [keepLine(sub.ids[1])])
    expect(res.success).toBe(true)
    expect(res.reservation_ids).toEqual([sub.ids[1]])
    expect(await statusOf(sub.ids[0])).toBe('cancelled')
    expect(await orderItemIds(sub.orderId)).toEqual([sub.ids[1]])
    expect((await orderRow(sub.orderId)).total_amount).toBeLessThan(before.total_amount)
    expect(res.reservation_code).toBe(sub.code)
  })

  it('라인 교체 + 재고 해제: 옛 기간 재고를 다른 고객이 다시 잡을 수 있다', async () => {
    const s = await createUser()
    const other = await createUser()
    const p = await createProduct('교체', 1)
    const sub = await submit(s, [p])
    const res = await editOk(s.client, sub.ids[0], sub.ids, [newLine(p, nextRange(2))])
    expect(res.success).toBe(true)
    const { data } = await other.client.rpc('create_hold_reservation', {
      p_product_id: p, p_start_date: sub.start, p_end_date: sub.end, p_pickup_method: 'visit', p_return_method: 'visit',
    })
    expect((data as Array<{ success: boolean }>)[0].success).toBe(true)
  })

  it('기간을 늘리면 주문 항목 금액과 주문 합계가 다시 계산된다', async () => {
    const s = await createUser()
    const p = await createProduct('금액')
    const sub = await submit(s, [p], nextRange(2))
    const before = await orderRow(sub.orderId)
    const res = await editOk(s.client, sub.ids[0], sub.ids, [newLine(p, nextRange(5))])
    expect(res.success).toBe(true)
    const after = await orderRow(sub.orderId)
    expect(after.total_amount).toBeGreaterThan(before.total_amount)
    const newId = (res.reservation_ids as number[])[0]
    const { data: item } = await admin.from('order_items').select('line_total').eq('reservation_id', newId).single()
    const { data: calc } = await admin.rpc('compute_reservation_line_amount', { p_reservation_id: newId })
    const c = (calc as Array<{ rental_fee: number; options_fee: number }>)[0]
    expect((item as { line_total: number }).line_total).toBe(c.rental_fee + c.options_fee)
  })

  it('발송됐지만 미서명인 계약서는 자동 폐기되고 계약 행은 새 대표 예약으로 옮겨진다', async () => {
    const s = await createUser()
    const p = await createProduct('계약폐기')
    const sub = await submit(s, [p])
    const { data: c } = await admin.from('contracts').insert({ reservation_id: sub.ids[0], user_id: s.userId }).select('id').single()
    const contractId = (c as { id: string }).id
    await admin.from('contract_signings').insert({ contract_id: contractId, user_id: s.userId, sent_at: new Date().toISOString() })
    const res = await editOk(s.client, sub.ids[0], sub.ids, [newLine(p, nextRange(3))])
    expect(res.success).toBe(true)
    const { data: sig } = await admin.from('contract_signings').select('sent_at, signed_at').eq('contract_id', contractId).single()
    expect(sig).toMatchObject({ sent_at: null, signed_at: null })
    const { data: ct } = await admin.from('contracts').select('reservation_id').eq('id', contractId).single()
    expect((ct as { reservation_id: number }).reservation_id).toBe((res.reservation_ids as number[])[0])
  })
})

describe('[TDD] 가드 — 사유 코드별 거절(원본 불변)', () => {
  async function expectRejected(reason: string, mutate: (sub: Submitted, s: Session) => Promise<void>): Promise<void> {
    const s = await createUser()
    const p = await createProduct(`가드-${reason}`)
    const sub = await submit(s, [p])
    await mutate(sub, s)
    const res = await editOk(s.client, sub.ids[0], sub.ids, [newLine(p, nextRange(3))])
    expect(res.success).toBe(false)
    expect(res.reason).toBe(reason)
    expect(await orderItemIds(sub.orderId)).toEqual(sub.ids)
    expect(await codesOf(sub.ids)).toEqual([sub.code])
  }

  it('SIGNED — 서명 완료 계약이 있으면 거절', async () => {
    await expectRejected('SIGNED', async (sub, s) => {
      const { data: c } = await admin.from('contracts').insert({ reservation_id: sub.ids[0], user_id: s.userId }).select('id').single()
      await admin.from('contract_signings').insert({ contract_id: (c as { id: string }).id, user_id: s.userId, sent_at: new Date().toISOString(), signed_at: new Date().toISOString() })
    })
  })
  it('PAID — payment_confirmed_at 이 있으면 거절', async () => {
    await expectRejected('PAID', async (sub) => {
      await admin.from('rental_reservations').update({ payment_confirmed_at: new Date().toISOString() }).eq('id', sub.ids[0])
    })
  })
  it('CANCEL_REQUESTED — 취소 요청이 있으면 거절', async () => {
    await expectRejected('CANCEL_REQUESTED', async (sub) => {
      await admin.from('rental_reservations').update({ cancel_requested_at: new Date().toISOString() }).eq('id', sub.ids[0])
    })
  })
  it('EXPIRED — 만료된 예약이면 거절', async () => {
    await expectRejected('EXPIRED', async (sub) => {
      await admin.from('rental_reservations').update({ status: 'expired' }).eq('id', sub.ids[0])
    })
  })
  it('DIRECT_PAY — 직접결제 주문이면 거절', async () => {
    await expectRejected('DIRECT_PAY', async (sub) => {
      await admin.from('orders').update({ direct_pay_expires_at: new Date(Date.now() + 3600_000).toISOString() }).eq('id', sub.orderId)
    })
  })
  it('NOT_HOLD — 신청대기가 아니면 거절', async () => {
    await expectRejected('NOT_HOLD', async (sub) => {
      await admin.from('rental_reservations').update({ status: 'confirmed' }).eq('id', sub.ids[0])
    })
  })
  it('우선순위 — 서명과 결제가 함께 있으면 SIGNED', async () => {
    await expectRejected('SIGNED', async (sub, s) => {
      await admin.from('rental_reservations').update({ payment_confirmed_at: new Date().toISOString() }).eq('id', sub.ids[0])
      const { data: c } = await admin.from('contracts').insert({ reservation_id: sub.ids[0], user_id: s.userId }).select('id').single()
      await admin.from('contract_signings').insert({ contract_id: (c as { id: string }).id, user_id: s.userId, signed_at: new Date().toISOString() })
    })
  })
})

describe('[TDD] 호출자·입력 거절', () => {
  it('타인 소유 주문은 NOT_OWNER 로 거절되고 원본이 그대로다', async () => {
    const owner = await createUser()
    const intruder = await createUser()
    const p = await createProduct('타인')
    const sub = await submit(owner, [p])
    const res = await editOk(intruder.client, sub.ids[0], sub.ids, [newLine(p, nextRange(3))])
    expect(res).toMatchObject({ success: false, reason: 'NOT_OWNER' })
    expect(await statusOf(sub.ids[0])).toBe('hold')
    expect(await orderItemIds(sub.orderId)).toEqual(sub.ids)
  })

  it('판정 함수(private)는 어떤 클라이언트로도 직접 호출할 수 없다', async () => {
    const s = await createUser()
    const r1 = await s.client.rpc('is_reservation_order_editable', { p_reservation_id: 1 })
    expect(r1.error).not.toBeNull()
    const r2 = await admin.rpc('is_reservation_order_editable', { p_reservation_id: 1 })
    expect(r2.error).not.toBeNull()
  })

  it('상품이 0개가 되는 저장(빈 목록)은 MIN_ONE_LINE 으로 거절된다', async () => {
    const s = await createUser()
    const p = await createProduct('최소1개')
    const sub = await submit(s, [p])
    const res = await editOk(s.client, sub.ids[0], sub.ids, [])
    expect(res).toMatchObject({ success: false, reason: 'MIN_ONE_LINE' })
    expect(await statusOf(sub.ids[0])).toBe('hold')
  })

  it('화면에서 불러온 뒤 주문 구성이 바뀌었으면(예약 id 집합 불일치) STALE 로 거절된다', async () => {
    const s = await createUser()
    const p = await createProduct('낡음')
    const sub = await submit(s, [p])
    const res = await editOk(s.client, sub.ids[0], [sub.ids[0] + 999999], [newLine(p, nextRange(3))])
    expect(res).toMatchObject({ success: false, reason: 'STALE' })
    expect(await statusOf(sub.ids[0])).toBe('hold')
  })
})

describe('[TDD] 동시성·원자성', () => {
  it('같은 주문을 두 탭에서 동시에 저장하면 한쪽만 성공한다', async () => {
    const s = await createUser()
    const p = await createProduct('동시', 2)
    const sub = await submit(s, [p])
    const [a, b] = await Promise.all([
      edit(s.client, sub.ids[0], sub.ids, [newLine(p, nextRange(3))]),
      edit(s.client, sub.ids[0], sub.ids, [newLine(p, nextRange(4))]),
    ])
    const results = [a.result, b.result]
    expect(results.filter(r => r?.success === true)).toHaveLength(1)
    expect(results.filter(r => r?.success === false && r.reason === 'STALE')).toHaveLength(1)
    const live = (await admin.from('order_items').select('reservation_id').eq('order_id', sub.orderId)).data ?? []
    expect(live).toHaveLength(1)
  })

  it('중간 실패(새 기간 재고 없음) 시 전체 원복 — 옛 예약·주문 항목·품번 그대로', async () => {
    const s = await createUser()
    const rival = await createUser()
    const p = await createProduct('원복', 1)
    const sub = await submit(s, [p])
    const taken = nextRange(2)
    await submit(rival, [p], taken)
    const res = await editOk(s.client, sub.ids[0], sub.ids, [newLine(p, taken)])
    expect(res.success).toBe(false)
    expect(res.reason).toBe('HOLD_FAILED')
    expect(await statusOf(sub.ids[0])).toBe('hold')
    expect(await orderItemIds(sub.orderId)).toEqual(sub.ids)
    expect(await codesOf(sub.ids)).toEqual([sub.code])
    const { data } = await admin.from('rental_reservations').select('id').eq('user_id', s.userId)
    expect(data).toHaveLength(1)
  })

  it('유지 줄이 이 주문의 예약이 아니면 BAD_REQUEST 로 거절되고 원본이 그대로다', async () => {
    const s = await createUser()
    const p = await createProduct('잘못된유지')
    const sub = await submit(s, [p])
    const res = await editOk(s.client, sub.ids[0], sub.ids, [keepLine(sub.ids[0] + 999999)])
    expect(res.success).toBe(false)
    expect(res.reason).toBe('BAD_REQUEST')
    expect(await statusOf(sub.ids[0])).toBe('hold')
  })
})

describe('[TDD] 낡은 요청(STALE) — 잠금·취소 뒤 도착한 저장', () => {
  it('이미 한 번 저장돼 옛 대표 예약이 취소된 뒤 같은 화면에서 다시 저장하면 ERROR 가 아니라 STALE 이다', async () => {
    const s = await createUser()
    const p = await createProduct('낡은화면')
    const sub = await submit(s, [p])
    const first = await editOk(s.client, sub.ids[0], sub.ids, [newLine(p, nextRange(3))])
    expect(first.success).toBe(true)
    const second = await editOk(s.client, sub.ids[0], sub.ids, [newLine(p, nextRange(4))])
    expect(second).toMatchObject({ success: false, reason: 'STALE' })
    expect(await orderItemIds(sub.orderId)).toEqual(first.reservation_ids)
  })

  it('타인의 낡은 예약 id 로는 STALE 이 아니라 NOT_OWNER 로만 답한다(존재 여부 비노출)', async () => {
    const owner = await createUser()
    const intruder = await createUser()
    const p = await createProduct('타인낡음')
    const sub = await submit(owner, [p])
    const res = await editOk(intruder.client, sub.ids[0], sub.ids, [newLine(p, nextRange(3))])
    expect(res).toMatchObject({ success: false, reason: 'NOT_OWNER' })
  })
})

describe('[TDD] 가드 보강 — 형제·결제 거래·서명 anchor', () => {
  it('PAID — 취소되지 않은 payment_transactions 거래가 있으면(payment_confirmed_at 없이도) 거절', async () => {
    const s = await createUser()
    const p = await createProduct('거래PAID')
    const sub = await submit(s, [p])
    const { error } = await admin.from('payment_transactions').insert({
      reservation_id: sub.ids[0], user_id: s.userId, payment_key: `tdd-pkey-${Date.now()}`,
      order_id: `CZ-tddedit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, idempotency_key: `tdd-idem-${Date.now()}`,
      total_amount: 60000, paid_amount: 60000, status: 'done',
    })
    expect(error, `거래 fixture 생성 실패: ${error?.message}`).toBeNull()
    const res = await editOk(s.client, sub.ids[0], sub.ids, [newLine(p, nextRange(3))])
    expect(res).toMatchObject({ success: false, reason: 'PAID' })
    expect(await orderItemIds(sub.orderId)).toEqual(sub.ids)
  })

  it('NOT_HOLD — 같은 주문의 다른 예약(형제)이 신청대기가 아니면 대상이 hold 여도 거절', async () => {
    const s = await createUser()
    const p1 = await createProduct('형제A')
    const p2 = await createProduct('형제B')
    const sub = await submit(s, [p1, p2])
    await admin.from('rental_reservations').update({ status: 'confirmed' }).eq('id', sub.ids[1])
    const res = await editOk(s.client, sub.ids[0], sub.ids, [keepLine(sub.ids[0]), keepLine(sub.ids[1])])
    expect(res).toMatchObject({ success: false, reason: 'NOT_HOLD' })
    expect(await statusOf(sub.ids[0])).toBe('hold')
  })

  it('SIGNED — 대표가 아닌 형제 예약에 anchor 된 계약의 서명도 막는다', async () => {
    const s = await createUser()
    const p1 = await createProduct('서명형제A')
    const p2 = await createProduct('서명형제B')
    const sub = await submit(s, [p1, p2])
    const { data: c } = await admin.from('contracts').insert({ reservation_id: sub.ids[1], user_id: s.userId }).select('id').single()
    await admin.from('contract_signings').insert({ contract_id: (c as { id: string }).id, user_id: s.userId, sent_at: new Date().toISOString(), signed_at: new Date().toISOString() })
    const res = await editOk(s.client, sub.ids[0], sub.ids, [keepLine(sub.ids[0]), keepLine(sub.ids[1])])
    expect(res).toMatchObject({ success: false, reason: 'SIGNED' })
  })

  it('최대 줄 수(50)를 넘기면 BAD_REQUEST 로 거절되고 원본이 그대로다', async () => {
    const s = await createUser()
    const p = await createProduct('최대줄')
    const sub = await submit(s, [p])
    const res = await editOk(s.client, sub.ids[0], sub.ids, Array.from({ length: 51 }, () => keepLine(sub.ids[0])))
    expect(res).toMatchObject({ success: false, reason: 'BAD_REQUEST' })
    expect(await statusOf(sub.ids[0])).toBe('hold')
  })

  it('같은 예약을 유지 줄로 두 번 보내면 BAD_REQUEST 로 거절된다', async () => {
    const s = await createUser()
    const p = await createProduct('keep중복')
    const sub = await submit(s, [p])
    const res = await editOk(s.client, sub.ids[0], sub.ids, [keepLine(sub.ids[0]), keepLine(sub.ids[0])])
    expect(res).toMatchObject({ success: false, reason: 'BAD_REQUEST' })
    expect(await statusOf(sub.ids[0])).toBe('hold')
  })
})

describe('[TDD] 승계 — 신청일시·예약승인 시각·합계', () => {
  it('submitted_at · approved_at · approve_requested_at 이 새 예약으로 이어진다', async () => {
    const s = await createUser()
    const p = await createProduct('승계')
    const sub = await submit(s, [p])
    const submittedAt = '2040-01-02T03:04:05.000Z'
    const approvedAt = '2040-01-03T04:05:06.000Z'
    const approveReqAt = '2040-01-02T05:06:07.000Z'
    await admin.from('rental_reservations').update({ submitted_at: submittedAt, approved_at: approvedAt, approve_requested_at: approveReqAt }).eq('id', sub.ids[0])
    const res = await editOk(s.client, sub.ids[0], sub.ids, [newLine(p, nextRange(3))])
    expect(res.success).toBe(true)
    const { data } = await admin.from('rental_reservations').select('submitted_at, approved_at, approve_requested_at').eq('id', (res.reservation_ids as number[])[0]).single()
    const row = data as { submitted_at: string; approved_at: string; approve_requested_at: string }
    expect(new Date(row.submitted_at).getTime()).toBe(new Date(submittedAt).getTime())
    expect(new Date(row.approved_at).getTime()).toBe(new Date(approvedAt).getTime())
    expect(new Date(row.approve_requested_at).getTime()).toBe(new Date(approveReqAt).getTime())
  })
})

describe('[TDD] 계약서 무효화(D2) — 발송 여부와 무관', () => {
  it('발송되지 않은 발행 계약서(내용만 있음)도 초기화되고 anchor 가 새 대표 예약으로 옮겨진다', async () => {
    const s = await createUser()
    const p = await createProduct('미발송계약')
    const sub = await submit(s, [p])
    const { data: c, error } = await admin.from('contracts').insert({ reservation_id: sub.ids[0], user_id: s.userId, title: '[TDD] 미발송 계약' }).select('id').single()
    expect(error, `계약 fixture 생성 실패: ${error?.message}`).toBeNull()
    const contractId = (c as { id: string }).id
    await admin.from('contract_signings').insert({ contract_id: contractId, user_id: s.userId })
    const res = await editOk(s.client, sub.ids[0], sub.ids, [newLine(p, nextRange(3))])
    expect(res.success).toBe(true)
    const { data: ct } = await admin.from('contracts').select('title, reservation_id').eq('id', contractId).single()
    expect(ct).toMatchObject({ title: null, reservation_id: (res.reservation_ids as number[])[0] })
  })
})

describe('[TDD] 배송비(D1) — 서버가 고객 값을 믿지 않는다', () => {
  it('배송비 인자(p_delivery_fee)는 더 이상 받지 않는다 — 넘기면 함수 불일치 오류이고 원본은 그대로', async () => {
    const s = await createUser()
    const p = await createProduct('배송비인자')
    const sub = await submit(s, [p])
    const { error } = await edit(s.client, sub.ids[0], sub.ids, [keepLine(sub.ids[0])], { p_delivery_fee: 99999 })
    expect(error).not.toBeNull()
    expect(await statusOf(sub.ids[0])).toBe('hold')
  })

  it('방문/방문 주문은 저장 시 배송비가 서버 계산값 0원으로 다시 정해진다(조작된 기존 값은 승계하지 않는다)', async () => {
    const s = await createUser()
    const p = await createProduct('배송비재계산0')
    const sub = await submit(s, [p])
    await admin.from('orders').update({ delivery_fee: 3000 }).eq('id', sub.orderId)
    const res = await editOk(s.client, sub.ids[0], sub.ids, [keepLine(sub.ids[0])])
    expect(res.success).toBe(true)
    const { data } = await admin.from('orders').select('delivery_fee').eq('id', sub.orderId).single()
    expect((data as { delivery_fee: number }).delivery_fee).toBe(0)
  })

  it('이전의 임시 거절 코드(DELIVERY_FEE_RECALC_REQUIRED)는 더 이상 나오지 않는다 — 줄을 바꿔도 저장된다', async () => {
    const s = await createUser()
    const p = await createProduct('배송비거절제거')
    const sub = await submit(s, [p])
    await admin.from('orders').update({ delivery_fee: 3000 }).eq('id', sub.orderId)
    const res = await editOk(s.client, sub.ids[0], sub.ids, [newLine(p, nextRange(3))])
    expect(res.reason).not.toBe('DELIVERY_FEE_RECALC_REQUIRED')
    expect(res).toMatchObject({ success: true, reason: 'ok' })
  })
  // 배송 수령·반납·우대 티어·구독 무료배송·상품 플래그·TS 동치는 deliveryFeeParityDb.test.ts 에서 시험한다
})

describe('[TDD] 옵션 단가는 서버가 정한다(SEC-811-01)', () => {
  async function setupWithOption(): Promise<{ s: Session; main: string; option: string; sub: Submitted; price: number }> {
    const s = await createUser()
    const main = await createProduct('옵션본상품')
    const option = await createProduct('옵션상품', 1)
    const { error } = await admin.from('product_option_links').insert({ product_id: main, option_product_id: option })
    if (error) throw new Error(`옵션 연결 실패: ${error.message}`)
    const { data: rule } = await admin.from('price_rules').select('price').eq('product_id', option).eq('duration_type', '24h').eq('is_active', true).is('deleted_at', null).limit(1).single()
    const sub = await submit(s, [main])
    return { s, main, option, sub, price: Number((rule as { price: number }).price) }
  }
  async function storedUnitPrice(reservationId: number, option: string): Promise<number | null> {
    const { data } = await admin.from('reservation_options').select('unit_price').eq('reservation_id', reservationId).eq('option_product_id', option).maybeSingle()
    return data ? Number((data as { unit_price: number }).unit_price) : null
  }

  for (const tampered of [-5000, 0, 1]) {
    it(`화면이 unit_price=${tampered} 를 보내도 옵션 단가는 옵션 상품의 24h 요금으로 저장된다`, async () => {
      const { s, main, option, sub, price } = await setupWithOption()
      const line = { ...newLine(main, nextRange(3)), options: [{ option_product_id: option, option_name: '조작된이름', qty: 1, unit_price: tampered }] }
      const res = await editOk(s.client, sub.ids[0], sub.ids, [line])
      expect(res.success, `${res.reason} ${res.message}`).toBe(true)
      expect(await storedUnitPrice((res.reservation_ids as number[])[0], option)).toBe(price)
    })
  }

  it('본상품에 연결되지 않은 옵션 상품은 OPTION_NOT_LINKED 로 거절되고 원본이 그대로다', async () => {
    const { s, main, sub } = await setupWithOption()
    const stranger = await createProduct('연결안된옵션', 1)
    const line = { ...newLine(main, nextRange(3)), options: [{ option_product_id: stranger, qty: 1, unit_price: 100 }] }
    const res = await editOk(s.client, sub.ids[0], sub.ids, [line])
    expect(res).toMatchObject({ success: false, reason: 'OPTION_NOT_LINKED' })
    expect(await statusOf(sub.ids[0])).toBe('hold')
    expect(await orderItemIds(sub.orderId)).toEqual(sub.ids)
  })
})

describe('[TDD] 요금 미등록·판매전용 차단', () => {
  it('24h 요금이 없는 상품을 새 줄로 넣으면 PRICE_UNSET 으로 거절되고 전체 원복된다(요금 없는 상품으로 hold 를 못 만드는 환경이면 HOLD_FAILED 로 대체 거절)', async () => {
    const s = await createUser()
    const p = await createProduct('요금있음')
    const noPrice = await createProduct('요금없음', 1, { withPrice: false })
    const sub = await submit(s, [p])
    const res = await editOk(s.client, sub.ids[0], sub.ids, [newLine(noPrice, nextRange(3))])
    expect(res.success).toBe(false)
    expect(['PRICE_UNSET', 'HOLD_FAILED']).toContain(res.reason)
    expect(res.reason, 'PRICE_UNSET 가 기대값이다 — HOLD_FAILED 면 fixture 가 hold 단계에서 막힌 것(가드 미검증)').toBe('PRICE_UNSET')
    expect(await statusOf(sub.ids[0])).toBe('hold')
    expect(await orderItemIds(sub.orderId)).toEqual(sub.ids)
  })

  it('새 줄이 판매전용 상품이면 SALE_ONLY_NOT_EDITABLE 로 거절되고 원본이 그대로다', async () => {
    const s = await createUser()
    const p = await createProduct('일반')
    const sale = await createProduct('판매전용', 1, { saleOnly: true })
    const sub = await submit(s, [p])
    const res = await editOk(s.client, sub.ids[0], sub.ids, [newLine(sale, nextRange(3))])
    expect(res).toMatchObject({ success: false, reason: 'SALE_ONLY_NOT_EDITABLE' })
    expect(await statusOf(sub.ids[0])).toBe('hold')
  })

  it('유지 줄이 판매전용 상품의 예약이면 SALE_ONLY_NOT_EDITABLE 로 거절된다', async () => {
    const s = await createUser()
    const p = await createProduct('나중에판매전용')
    const sub = await submit(s, [p])
    await admin.from('products').update({ sale_only: true, sale_price: 10000 }).eq('id', p)
    const res = await editOk(s.client, sub.ids[0], sub.ids, [keepLine(sub.ids[0])])
    expect(res).toMatchObject({ success: false, reason: 'SALE_ONLY_NOT_EDITABLE' })
  })
})

describe('[TDD] 쿠폰·포인트 — 해제·탈락·소진 흔적', () => {
  async function createCoupon(opts: { minAmount?: number } = {}): Promise<string> {
    const code = `TDD_EDIT_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`
    const { data: coupon, error } = await admin.from('coupons').insert({
      code, type: 'all', validity_type: 'fixed_period', discount_type: 'fixed', discount_value: 1000,
      allow_stacking: true, allow_with_points: true, is_active: true,
      min_purchase_amount: opts.minAmount ?? 0, min_rental_amount: opts.minAmount ?? 0, min_rental_days: 0,
      is_first_rental_only: false, is_student_only: false, is_subscription_only: false, is_walk_in_only: false,
      usage_limit: 1, usage_count: 0, total_usage_limit: null,
    }).select('id').single()
    if (error || !coupon) throw new Error(`쿠폰 생성 실패: ${error?.message}`)
    const couponId = (coupon as { id: string }).id
    cleanups.unshift(async () => {
      await admin.from('user_coupons').delete().eq('coupon_id', couponId)
      await admin.from('coupons').delete().eq('id', couponId)
    })
    return couponId
  }
  async function submitWithCoupon(s: Session, p: string, minAmount?: number): Promise<{ sub: Submitted; userCouponId: string }> {
    const couponId = await createCoupon({ minAmount })
    const { data: uc, error } = await admin.from('user_coupons').insert({ user_id: s.userId, coupon_id: couponId, used_count: 0 }).select('id').single()
    if (error || !uc) throw new Error(`user_coupon 생성 실패: ${error?.message}`)
    const userCouponId = (uc as { id: string }).id
    const sub = await submit(s, [p])
    const { error: oErr } = await admin.rpc('create_reservation_order', { p_user_id: s.userId, p_reservation_ids: sub.ids, p_selected_coupon_ids: [userCouponId] })
    if (oErr) throw new Error(`쿠폰 주문 재계산 실패: ${oErr.message}`)
    return { sub, userCouponId }
  }
  async function orderCouponCount(orderId: number): Promise<number> {
    const { data } = await admin.from('order_coupons').select('user_coupon_id').eq('order_id', orderId)
    return (data ?? []).length
  }

  it('쿠폰을 전부 해제(빈 선택)하면 order_coupons 가 비고 쿠폰 할인이 0 이 된다', async () => {
    const s = await createUser()
    const p = await createProduct('쿠폰해제')
    const { sub } = await submitWithCoupon(s, p)
    expect(await orderCouponCount(sub.orderId)).toBe(1)
    const res = await editOk(s.client, sub.ids[0], sub.ids, [newLine(p, nextRange(3))], { p_selected_coupon_ids: [] })
    expect(res.success, `${res.reason} ${res.message}`).toBe(true)
    expect(await orderCouponCount(sub.orderId)).toBe(0)
    const { data } = await admin.from('orders').select('coupon_discount_amount').eq('id', sub.orderId).single()
    expect(Number((data as { coupon_discount_amount: number }).coupon_discount_amount)).toBe(0)
  })

  it('쿠폰 선택을 보내지 않으면(NULL) 기존 쿠폰이 유지된다', async () => {
    const s = await createUser()
    const p = await createProduct('쿠폰유지')
    const { sub } = await submitWithCoupon(s, p)
    const res = await editOk(s.client, sub.ids[0], sub.ids, [newLine(p, nextRange(3))])
    expect(res.success, `${res.reason} ${res.message}`).toBe(true)
    expect(await orderCouponCount(sub.orderId)).toBe(1)
  })

  it('선택한 쿠폰이 전부 부적격으로 탈락하면 order_coupons 가 남지 않고 dropped_coupons 에 사유가 담긴다', async () => {
    const s = await createUser()
    const p = await createProduct('쿠폰탈락')
    const { sub, userCouponId } = await submitWithCoupon(s, p, 99999999)
    const res = await editOk(s.client, sub.ids[0], sub.ids, [newLine(p, nextRange(3))], { p_selected_coupon_ids: [userCouponId] })
    expect(res.success, `${res.reason} ${res.message}`).toBe(true)
    expect(res.dropped_coupons).toHaveLength(1)
    expect(await orderCouponCount(sub.orderId)).toBe(0)
  })

  it('이미 소진된 쿠폰이 있는 주문은 PAID 로 거절된다(복원 트리거 이중 복원 방어)', async () => {
    const s = await createUser()
    const p = await createProduct('쿠폰소진')
    const { sub, userCouponId } = await submitWithCoupon(s, p)
    await admin.from('user_coupons').update({ used_at: new Date().toISOString(), used_count: 1, order_id: sub.orderId }).eq('id', userCouponId)
    const res = await editOk(s.client, sub.ids[0], sub.ids, [newLine(p, nextRange(3))])
    expect(res).toMatchObject({ success: false, reason: 'PAID' })
    expect(await statusOf(sub.ids[0])).toBe('hold')
  })

  it('모든 줄 교체 + 쿠폰·포인트 선택 주문: 옛 예약 취소가 혜택 복원(포인트 환원 기록·쿠폰 상태 변경)을 일으키지 않는다', async () => {
    const s = await createUser()
    const p = await createProduct('전체교체혜택')
    const { sub, userCouponId } = await submitWithCoupon(s, p)
    await admin.from('orders').update({ selected_points: 500 }).eq('id', sub.orderId)
    const res = await editOk(s.client, sub.ids[0], sub.ids, [newLine(p, nextRange(3))])
    expect(res.success, `${res.reason} ${res.message}`).toBe(true)
    const { data: refunds } = await admin.from('point_transactions').select('id').eq('type', 'refund').eq('ref_type', 'order').eq('ref_id', String(sub.orderId))
    expect(refunds ?? []).toHaveLength(0)
    const { data: uc } = await admin.from('user_coupons').select('used_at, used_count').eq('id', userCouponId).single()
    expect(uc).toMatchObject({ used_at: null, used_count: 0 })
  })

  it('구형 단일 쿠폰(orders.selected_coupon_id)도 편집 후 조건을 다시 검증받아 탈락하면 dropped_coupons 에 담긴다(SEC-811-10)', async () => {
    const s = await createUser()
    const p = await createProduct('단일쿠폰탈락')
    const { sub, userCouponId } = await submitWithCoupon(s, p, 99999999)
    // 다중 쿠폰 행을 지우고 구형 단일 컬럼만 남긴 옛 주문 상태를 만든다
    await admin.from('order_coupons').delete().eq('order_id', sub.orderId)
    const { error: uErr } = await admin.from('orders').update({ selected_coupon_id: userCouponId }).eq('id', sub.orderId)
    expect(uErr, `구형 단일 쿠폰 fixture 실패: ${uErr?.message}`).toBeNull()
    const res = await editOk(s.client, sub.ids[0], sub.ids, [newLine(p, nextRange(3))])
    expect(res.success, `${res.reason} ${res.message}`).toBe(true)
    expect(res.dropped_coupons).toHaveLength(1)
    expect(await orderCouponCount(sub.orderId)).toBe(0)
    const { data } = await admin.from('orders').select('coupon_discount_amount').eq('id', sub.orderId).single()
    expect(Number((data as { coupon_discount_amount: number }).coupon_discount_amount)).toBe(0)
  })

  it('수정 가능 여부 조회(get_reservation_edit_state)도 쿠폰 소진 흔적을 PAID 로 돌려준다(판정 정본 통합)', async () => {
    const s = await createUser()
    const p = await createProduct('쿠폰소진상태')
    const { sub, userCouponId } = await submitWithCoupon(s, p)
    await admin.from('user_coupons').update({ used_at: new Date().toISOString(), used_count: 1, order_id: sub.orderId }).eq('id', userCouponId)
    const { data, error } = await s.client.rpc('get_reservation_edit_state', { p_reservation_id: sub.ids[0] })
    expect(error).toBeNull()
    expect(data).toEqual({ ok: true, can_edit: false, reason: 'PAID' })
  })
})

describe('[TDD] 오류 문구 정제(SEC-811-06)', () => {
  it('실패 응답의 message 는 고정 문구이고 내부 오류 원문(SQL·함수명·id)이 담기지 않는다', async () => {
    const s = await createUser()
    const p = await createProduct('문구')
    const rival = await createUser()
    const sub = await submit(s, [p])
    const taken = nextRange(2)
    await submit(rival, [p], taken)
    const res = await editOk(s.client, sub.ids[0], sub.ids, [newLine(p, taken)])
    expect(res.reason).toBe('HOLD_FAILED')
    expect(res.message).toBe('선택한 기간에 예약할 수 있는 재고가 없어요')
    expect(res.message).not.toMatch(/create_hold_reservation|rental_reservations|SQLSTATE|ERROR:|\d{3,}/)
  })
})


// ─────────────────────────────────────────────────────────────────────────────
// S2 2차 재작업 시험
// ─────────────────────────────────────────────────────────────────────────────
async function createTempMethod(kind: 'inactive' | 'deleted'): Promise<string> {
  const key = `tdd_${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const { data, error } = await admin.from('rental_method_options').insert({
    name: `[TDD] ${kind}`, method_key: key, is_delivery_type: true, display_order: 99,
    is_active: kind !== 'inactive', deleted_at: kind === 'deleted' ? new Date().toISOString() : null,
  }).select('id').single()
  if (error || !data) throw new Error(`시험용 방식 행 생성 실패: ${error?.message}`)
  const id = (data as { id: string }).id
  cleanups.push(async () => { await admin.from('rental_method_options').delete().eq('id', id) })
  return key
}

describe('[TDD] 수령·반납 방식 검증(SEC-811-08 a·c)', () => {
  async function rejected(method: { pickup?: string; ret?: string }, mutateKept = false): Promise<void> {
    const s = await createUser()
    const p = await createProduct('방식검증')
    const sub = await submit(s, [p])
    let lines: Line[]
    if (mutateKept) {
      await admin.from('rental_reservations').update({ pickup_method: method.pickup }).eq('id', sub.ids[0])
      lines = [keepLine(sub.ids[0])]
    } else {
      lines = [{ ...newLine(p, nextRange(3)), pickup_method: method.pickup ?? 'visit', return_method: method.ret ?? 'visit' }]
    }
    const res = await editOk(s.client, sub.ids[0], sub.ids, lines)
    expect(res).toMatchObject({ success: false, reason: 'INVALID_METHOD' })
    expect(await statusOf(sub.ids[0])).toBe('hold')
    expect(await orderItemIds(sub.orderId)).toEqual(sub.ids)
  }
  it('등록되지 않은 수령 방식은 INVALID_METHOD 로 거절되고 원본이 그대로다', async () => { await rejected({ pickup: `tdd_nokey_${Date.now()}` }) })
  it('등록되지 않은 반납 방식도 INVALID_METHOD', async () => { await rejected({ ret: `tdd_nokey_${Date.now()}` }) })
  it('비활성 배송형 방식(수령)은 INVALID_METHOD — 배송 아님(0원)으로 넘어가지 않는다', async () => { await rejected({ pickup: await createTempMethod('inactive') }) })
  it('삭제된 방식(반납)도 INVALID_METHOD', async () => { await rejected({ ret: await createTempMethod('deleted') }) })
  it('유지 줄에 저장된 방식이 비활성이 됐으면 INVALID_METHOD', async () => { await rejected({ pickup: await createTempMethod('inactive') }, true) })
})

describe('[TDD] 수령·반납 시간 검증(SEC-811-08 b)', () => {
  async function expectTime(patch: Partial<Line>, sameDay = false): Promise<void> {
    const s = await createUser()
    const p = await createProduct('시간검증')
    const sub = await submit(s, [p])
    const r = nextRange(2)
    const base = newLine(p, sameDay ? { start: r.start, end: r.start } : r)
    const res = await editOk(s.client, sub.ids[0], sub.ids, [{ ...base, ...patch }])
    expect(res).toMatchObject({ success: false, reason: 'INVALID_TIME' })
    expect(res.message).toBe('수령·반납 시간이 올바르지 않아요')
    expect(await statusOf(sub.ids[0])).toBe('hold')
    expect(await orderItemIds(sub.orderId)).toEqual(sub.ids)
  }
  it('같은 날 반납(01:00)이 수령(23:00)보다 이르면 거절 — 0원 경로 차단', async () => { await expectTime({ pickup_time: '23:00', return_time: '01:00' }, true) })
  it('같은 날 수령·반납 시각이 같으면 거절', async () => { await expectTime({ pickup_time: '10:00', return_time: '10:00' }, true) })
  for (const [label, patch] of [
    ['수령 25:00', { pickup_time: '25:00' }], ['수령 한 자리 시(9:00)', { pickup_time: '9:00' }],
    ['분 60', { return_time: '10:60' }], ['반납 24:01', { return_time: '24:01' }], ['수령 24:00(수령은 24:00 불가)', { pickup_time: '24:00' }],
    ['문자 혼입', { return_time: 'ab:cd' }],
  ] as Array<[string, Partial<Line>]>) {
    it(`형식 오류(${label})는 거절`, async () => { await expectTime(patch) })
  }
  it('방문 수령인데 시간이 없으면(NULL) 거절', async () => {
    const s = await createUser()
    const p = await createProduct('시간없음')
    const sub = await submit(s, [p])
    const { pickup_time: _p, return_time: _r, ...noTimes } = newLine(p, nextRange(3))
    void _p; void _r
    const res = await editOk(s.client, sub.ids[0], sub.ids, [noTimes])
    expect(res).toMatchObject({ success: false, reason: 'INVALID_TIME' })
  })
  it('반납 24:00 은 정책 값이라 허용된다(수령 배송 시 반납 24:00 고정 규칙과 같은 형식)', async () => {
    const s = await createUser()
    const p = await createProduct('반납24')
    const sub = await submit(s, [p])
    const res = await editOk(s.client, sub.ids[0], sub.ids, [{ ...newLine(p, nextRange(2)), return_time: '24:00' }])
    expect(res, JSON.stringify(res)).toMatchObject({ success: true, reason: 'ok' })
  })
})

describe('[TDD] 오류 코드 매핑·반환 값(MINOR)', () => {
  it('소문자 서버 오류 코드는 대문자 고유 reason 과 고정 문구로 내려간다(원문 비노출)', async () => {
    const s = await createUser()
    const p = await createProduct('코드매핑')
    const sub = await submit(s, [p])
    const res = await editOk(s.client, sub.ids[0], sub.ids, [{ ...newLine(p, nextRange(3)), frontdoor_password: 'x'.repeat(51) }])
    expect(res).toMatchObject({ success: false, reason: 'FRONTDOOR_PASSWORD_TOO_LONG', message: '공동현관 출입번호가 너무 길어요' })
    expect(res.message).not.toMatch(/frontdoor_password_too_long|50자/)
    expect(await statusOf(sub.ids[0])).toBe('hold')
  })

  it('성공 응답에 정규화 포인트·배송비·합계·취소된 옛 예약 id 가 들어 있고 DB 저장값과 같다', async () => {
    const s = await createUser()
    const p1 = await createProduct('반환1')
    const p2 = await createProduct('반환2')
    const sub = await submit(s, [p1, p2])
    const res = await editOk(s.client, sub.ids[0], sub.ids, [keepLine(sub.ids[1]), newLine(p1, nextRange(3))])
    expect(res.success, `${res.reason} ${res.message}`).toBe(true)
    expect(res.cancelled_reservation_ids).toEqual([sub.ids[0]])
    const row = await orderRow(sub.orderId)
    expect(res.total_amount).toBe(row.total_amount)
    expect(res.final_amount).toBe(row.final_amount)
    expect(res.delivery_fee).toBe(0)
    expect(typeof res.selected_points).toBe('number')
    const keepOnly = await editOk(s.client, (res.reservation_ids as number[])[0], res.reservation_ids as number[], [keepLine((res.reservation_ids as number[])[0])])
    expect(keepOnly.success, `${keepOnly.reason} ${keepOnly.message}`).toBe(true)
    expect(keepOnly.cancelled_reservation_ids).toHaveLength(1)
  })
})

describe('[TDD] 옵션 — 중복 줄 합산·재고·단가 없음(SEC-811-09)', () => {
  async function setup(optChildren: number, withPrice = true): Promise<{ s: Session; main: string; option: string; sub: Submitted }> {
    const s = await createUser()
    const main = await createProduct('옵션본')
    const option = await createProduct('옵션', optChildren, { withPrice })
    const { error } = await admin.from('product_option_links').insert({ product_id: main, option_product_id: option })
    if (error) throw new Error(`옵션 연결 실패: ${error.message}`)
    return { s, main, option, sub: await submit(s, [main]) }
  }
  it('같은 옵션이 두 줄로 오면 수량이 합산되어 한 행으로 저장된다', async () => {
    const { s, main, option, sub } = await setup(2)
    const line = { ...newLine(main, nextRange(3)), options: [{ option_product_id: option, qty: 1 }, { option_product_id: option, qty: 1 }] }
    const res = await editOk(s.client, sub.ids[0], sub.ids, [line])
    expect(res.success, `${res.reason} ${res.message}`).toBe(true)
    const { data } = await admin.from('reservation_options').select('qty').eq('reservation_id', (res.reservation_ids as number[])[0]).eq('option_product_id', option)
    expect(((data ?? []) as Array<{ qty: number }>).map(r => r.qty)).toEqual([2])
  })
  it('합산 수량이 옵션 재고를 넘으면 OPTION_STOCK_EXCEEDED 로 거절되고 원본이 그대로다', async () => {
    const { s, main, option, sub } = await setup(1)
    const line = { ...newLine(main, nextRange(3)), options: [{ option_product_id: option, qty: 1 }, { option_product_id: option, qty: 1 }] }
    const res = await editOk(s.client, sub.ids[0], sub.ids, [line])
    expect(res).toMatchObject({ success: false, reason: 'OPTION_STOCK_EXCEEDED' })
    expect(await statusOf(sub.ids[0])).toBe('hold')
    expect(await orderItemIds(sub.orderId)).toEqual(sub.ids)
  })
  it('옵션 상품에 활성 24h 요금이 없으면 PRICE_UNSET 으로 거절된다(0원으로 저장하지 않는다)', async () => {
    const { s, main, option, sub } = await setup(1, false)
    const line = { ...newLine(main, nextRange(3)), options: [{ option_product_id: option, qty: 1, unit_price: 0 }] }
    const res = await editOk(s.client, sub.ids[0], sub.ids, [line])
    expect(res).toMatchObject({ success: false, reason: 'PRICE_UNSET' })
    expect(await statusOf(sub.ids[0])).toBe('hold')
  })
})

describe('[TDD] 합계 정합 — 수량 연동 옵션(유지 줄 포함)·취소 형제(sp3 MAJOR)', () => {
  async function sumOfLines(ids: number[]): Promise<number> {
    let sum = 0
    for (const id of ids) {
      const { data } = await admin.rpc('compute_reservation_line_amount', { p_reservation_id: id })
      const c = (data as Array<{ rental_fee: number; options_fee: number; holiday_extra_fee?: number }>)[0]
      sum += Number(c.rental_fee) + Number(c.options_fee) + Number(c.holiday_extra_fee ?? 0)
    }
    return sum
  }

  it('유지 줄 + 같은 상품·같은 날짜 새 줄: 수량 연동 옵션이 그룹 크기(2)로 맞춰지고 합계가 줄 합과 같다', async () => {
    const s = await createUser()
    const main = await createProduct('연동본', 2)
    const option = await createProduct('연동옵션', 2)
    const { error } = await admin.from('product_option_links').insert({ product_id: main, option_product_id: option, qty_follows_main: true })
    if (error) throw new Error(`연동 옵션 연결 실패: ${error.message}`)
    const sub = await submit(s, [main])
    const { data: rule } = await admin.from('price_rules').select('price').eq('product_id', option).eq('duration_type', '24h').eq('is_active', true).is('deleted_at', null).limit(1).single()
    const { error: oErr } = await s.client.rpc('set_reservation_options', {
      p_reservation_id: sub.ids[0], p_options: [{ option_product_id: option, option_name: '연동옵션', qty: 1, unit_price: Number((rule as { price: number }).price) }],
    })
    expect(oErr, `옵션 fixture 실패: ${oErr?.message}`).toBeNull()
    const res = await editOk(s.client, sub.ids[0], sub.ids, [keepLine(sub.ids[0]), newLine(main, sub)])
    expect(res.success, `${res.reason} ${res.message}`).toBe(true)
    const { data: opts } = await admin.from('reservation_options').select('qty').eq('reservation_id', sub.ids[0]).eq('option_product_id', option)
    expect(((opts ?? []) as Array<{ qty: number }>).map(o => o.qty)).toEqual([2])
    const ids = res.reservation_ids as number[]
    expect((await orderRow(sub.orderId)).total_amount).toBe(await sumOfLines(ids))
    const { data: items } = await admin.from('order_items').select('line_total').eq('order_id', sub.orderId)
    expect(((items ?? []) as Array<{ line_total: number }>).reduce((a, r) => a + Number(r.line_total), 0)).toBe(await sumOfLines(ids))
  })

  it('이미 취소된 형제가 있는 주문: 합계에 취소된 줄이 남지 않는다', async () => {
    const s = await createUser()
    const p1 = await createProduct('취소형제1')
    const p2 = await createProduct('취소형제2')
    const sub = await submit(s, [p1, p2])
    await admin.from('rental_reservations').update({ status: 'cancelled' }).eq('id', sub.ids[0])
    const res = await editOk(s.client, sub.ids[1], [sub.ids[1]], [keepLine(sub.ids[1])])
    expect(res.success, `${res.reason} ${res.message}`).toBe(true)
    expect(await orderItemIds(sub.orderId)).toEqual([sub.ids[1]])
    expect((await orderRow(sub.orderId)).total_amount).toBe(await sumOfLines([sub.ids[1]]))
  })
})

describe('[TDD] 수정 가능 여부 조회 get_reservation_edit_state', () => {
  const cases: Array<[string, (sub: Submitted, s: Session) => Promise<void>]> = [
    ['SIGNED', async (sub, s) => {
      const { data: c } = await admin.from('contracts').insert({ reservation_id: sub.ids[0], user_id: s.userId }).select('id').single()
      await admin.from('contract_signings').insert({ contract_id: (c as { id: string }).id, user_id: s.userId, sent_at: new Date().toISOString(), signed_at: new Date().toISOString() })
    }],
    ['PAID', async (sub) => { await admin.from('rental_reservations').update({ payment_confirmed_at: new Date().toISOString() }).eq('id', sub.ids[0]) }],
    ['CANCEL_REQUESTED', async (sub) => { await admin.from('rental_reservations').update({ cancel_requested_at: new Date().toISOString() }).eq('id', sub.ids[0]) }],
    ['EXPIRED', async (sub) => { await admin.from('rental_reservations').update({ status: 'expired' }).eq('id', sub.ids[0]) }],
    ['DIRECT_PAY', async (sub) => { await admin.from('orders').update({ direct_pay_expires_at: new Date(Date.now() + 3600_000).toISOString() }).eq('id', sub.orderId) }],
    ['NOT_HOLD', async (sub) => { await admin.from('rental_reservations').update({ status: 'confirmed' }).eq('id', sub.ids[0]) }],
  ]
  async function state(client: SupabaseClient, id: number): Promise<{ data: Record<string, unknown> | null; error: { code?: string; message: string } | null }> {
    const { data, error } = await client.rpc('get_reservation_edit_state', { p_reservation_id: id })
    return { data: (data as Record<string, unknown> | null) ?? null, error: error as { code?: string; message: string } | null }
  }
  it('수정 가능한 신청대기 예약은 {ok:true, can_edit:true, reason:ok} 만 돌려준다(다른 키 없음)', async () => {
    const s = await createUser()
    const p = await createProduct('상태정상')
    const sub = await submit(s, [p])
    const r = await state(s.client, sub.ids[0])
    expect(r.error).toBeNull()
    expect(r.data).toEqual({ ok: true, can_edit: true, reason: 'ok' })
  })
  for (const [reason, mutate] of cases) {
    it(`${reason} — 편집 함수와 같은 사유 코드를 돌려준다`, async () => {
      const s = await createUser()
      const p = await createProduct(`상태-${reason}`)
      const sub = await submit(s, [p])
      await mutate(sub, s)
      const r = await state(s.client, sub.ids[0])
      expect(r.error).toBeNull()
      expect(r.data).toEqual({ ok: true, can_edit: false, reason })
    })
  }
  it('타인의 예약과 존재하지 않는 예약은 같은 응답(NOT_OWNER)이다', async () => {
    const owner = await createUser()
    const intruder = await createUser()
    const p = await createProduct('상태타인')
    const sub = await submit(owner, [p])
    const other = await state(intruder.client, sub.ids[0])
    const missing = await state(intruder.client, sub.ids[0] + 999999)
    expect(other.data).toEqual({ ok: false, can_edit: false, reason: 'NOT_OWNER' })
    expect(missing.data).toEqual(other.data)
  })
  it('비로그인(anon)·서버 전용(service_role) 호출은 권한 오류로 막힌다', async () => {
    const owner = await createUser()
    const p = await createProduct('상태익명')
    const sub = await submit(owner, [p])
    const a = await state(anon, sub.ids[0])
    expect(a.error?.code, `anon: ${a.error?.message}`).toBe('42501')
    const sr = await state(admin, sub.ids[0])
    expect(sr.error?.code, `service_role: ${sr.error?.message}`).toBe('42501')
  })
})
