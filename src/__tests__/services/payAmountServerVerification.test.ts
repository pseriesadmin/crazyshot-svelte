/**
 * TDD (RED 먼저): payAmountServerVerification.test.ts — 결제 확정 경로의 서버 금액 대조
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트. fixture는 이 파일이 생성·정리한다.
 *
 * 배경(2026-10-03 재분석, 코드 근거 — 이 테스트가 재현 여부를 확정한다):
 *   A) POST /api/contracts/[token]/pay-mock 이 orders.final_amount를 검사하지 않고 결제완료(payment_confirmed_at)로
 *      기록한다(대조군 api/checkout/pay-free 는 "0원이 아니면 거부" 가드가 있다).
 *   B) confirm_order_payment_and_update_reservations 가 p_paid_amount 와 orders.final_amount 를 비교하지 않는다.
 *
 * 기대 동작(보강 후):
 *   A) 결제금액이 0원이 아닌 주문은 pay-mock 으로 확정할 수 없다(4xx, 예약은 hold 유지·payment_confirmed_at NULL).
 *      0원 주문(쿠폰·포인트 전액)은 기존대로 확정된다(무회귀).
 *   B) 실제 존재하는 주문에 대해 p_paid_amount ≠ final_amount 이면 거부한다.
 *      (주문이 없는 p_order_id 로 호출하는 기존 RPC 테스트(tossPaymentGroupRpc)는 영향이 없어야 한다.)
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { POST as signContract } from '../../routes/api/contracts/[token]/sign/+server'
import { POST as payMock } from '../../routes/api/contracts/[token]/pay-mock/+server'
import { load as payResultLoad } from '../../routes/contract/[token]/pay-result/+page.server'
import { POST as payStart } from '../../routes/api/contracts/[token]/pay-start/+server'
import { isAcceptedContractTossOrderId } from '$lib/server/checkout/contractPay'
import { ensure24hPriceRule } from '../helpers/ensure24hPriceRule'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

let testProductId: string
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

beforeAll(async () => {
  const { data, error } = await admin.from('products').select('id').is('parent_product_id', null).eq('is_active', true).limit(1).single()
  if (error || !data) throw new Error(`테스트용 product 조회 실패: ${error?.message}`)
  testProductId = (data as { id: string }).id
  await ensure24hPriceRule(admin, testProductId)
}, 60000)

const _slotBase = Date.now() % 1000
let _slot = 0
/** 다른 테스트와 겹치지 않는 먼 미래 구간 */
function range(): { start: string; end: string } {
  _slot += 1
  const start = new Date(Date.UTC(2045, 0, 1) + (_slotBase * 40 + _slot) * 5 * 86400000)
  const end = new Date(start.getTime() + 2 * 86400000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { start: fmt(start), end: fmt(end) }
}

async function createUser(): Promise<string> {
  const email = `tdd-payamt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !data.user) throw new Error(`user 생성 실패: ${error?.message}`)
  cleanups.push(async () => { await admin.auth.admin.deleteUser(data.user!.id) })
  return data.user.id
}

interface Fixture { userId: string; reservationId: number; orderId: number; finalAmount: number; token: string }

/** 유료 주문(final_amount>0) + 발송된 계약 + 서명 완료까지 만든다(결제 직전 상태). */
async function createSignedPaidOrder(): Promise<Fixture> {
  const userId = await createUser()
  const { start, end } = range()
  const { data: res, error: resErr } = await admin.from('rental_reservations').insert({
    user_id: userId, product_id: testProductId, start_date: start, end_date: end,
    status: 'hold', pickup_method: 'visit', return_method: 'visit',
  }).select('id').single()
  if (resErr || !res) throw new Error(`reservation 생성 실패: ${resErr?.message}`)
  const reservationId = (res as { id: number }).id

  const { data: orderRows, error: orderErr } = await admin.rpc('create_reservation_order', {
    p_user_id: userId, p_reservation_ids: [reservationId],
  })
  if (orderErr) throw new Error(`create_reservation_order 실패: ${orderErr.message}`)
  const orderId = Number((Array.isArray(orderRows) ? orderRows[0] : orderRows)?.order_id ?? (Array.isArray(orderRows) ? orderRows[0]?.id : NaN))
  if (!Number.isFinite(orderId)) throw new Error(`order id 확인 실패: ${JSON.stringify(orderRows)}`)

  const { data: ord } = await admin.from('orders').select('final_amount').eq('id', orderId).single()
  const finalAmount = Number((ord as { final_amount: number | null } | null)?.final_amount ?? 0)

  const { data: contract, error: cErr } = await admin.from('contracts').insert({
    reservation_id: reservationId, user_id: userId, contract_type: 'rental', status: 'active',
  }).select('id').single()
  if (cErr || !contract) throw new Error(`contract 생성 실패: ${cErr?.message}`)
  const { data: signing, error: sErr } = await admin.from('contract_signings').insert({
    contract_id: (contract as { id: string }).id, user_id: userId, sent_at: new Date().toISOString(),
  }).select('id, token').single()
  if (sErr || !signing) throw new Error(`signing 생성 실패: ${sErr?.message}`)
  const token = (signing as { token: string }).token

  cleanups.push(async () => {
    await admin.from('payment_transactions').delete().eq('reservation_id', reservationId)
    await admin.from('contract_signings').delete().eq('id', (signing as { id: string }).id)
    await admin.from('contracts').delete().eq('id', (contract as { id: string }).id)
    await admin.from('order_items').delete().eq('order_id', orderId)
    await admin.from('orders').delete().eq('id', orderId)
    await admin.from('rental_reservations').delete().eq('id', reservationId)
  })

  // 서명 완료(결제는 아직 안 함)
  const signReq = new Request(`http://localhost/api/contracts/${token}/sign`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    // 2026-10-06: 서명 API가 필수 동의 3종을 서버에서 검증한다(Migration #650 증적 강화)
    body: JSON.stringify({
      signature_data: 'data:image/png;base64,AAAA',
      stroke_count: 3,
      consents: [
        { key: 'contract', checked: true },
        { key: 'privacy', checked: true },
        { key: 'terms_copy', checked: true },
      ],
    }),
  })
  const signRes = await signContract({ params: { token }, request: signReq, getClientAddress: () => '127.0.0.1' } as unknown as Parameters<typeof signContract>[0])
  if (signRes.status >= 400) throw new Error(`서명 실패: ${signRes.status}`)

  return { userId, reservationId, orderId, finalAmount, token }
}

async function callPayMock(token: string, payload: Record<string, unknown> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const request = new Request(`http://localhost/api/contracts/${token}/pay-mock`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  })
  const res = await payMock({ params: { token }, request } as unknown as Parameters<typeof payMock>[0])
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

async function callPayStartLocal(token: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await payStart({ params: { token }, request: new Request('http://localhost', { method: 'POST' }) } as unknown as Parameters<typeof payStart>[0])
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

async function reservationRow(id: number): Promise<{ status: string; payment_confirmed_at: string | null }> {
  const { data } = await admin.from('rental_reservations').select('status, payment_confirmed_at').eq('id', id).single()
  return data as { status: string; payment_confirmed_at: string | null }
}

describe('A) pay-mock — 유료 주문은 결제 없이 확정할 수 없다', () => {
  it('fixture 전제: 유료 주문(final_amount>0)이 만들어진다', async () => {
    const f = await createSignedPaidOrder()
    expect(f.finalAmount).toBeGreaterThan(0)
  }, 60000)

  it('RED→GREEN: final_amount>0 주문에 pay-mock 호출 → 4xx 거부 + hold 유지 + payment_confirmed_at NULL', async () => {
    const f = await createSignedPaidOrder()
    expect(f.finalAmount).toBeGreaterThan(0)

    const res = await callPayMock(f.token, {})
    const row = await reservationRow(f.reservationId)

    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(row.payment_confirmed_at).toBeNull()
    expect(row.status).toBe('hold')
  }, 60000)

  it('RED→GREEN: 주문(order_items)이 없는 신청대기 예약은 pay-mock 으로 확정할 수 없다(409 ORDER_REQUIRED)', async () => {
    const f = await createSignedPaidOrder()
    // 주문 연결을 끊어 "주문 없는 예약"을 재현(관리자 권한 fixture 조작)
    await admin.from('order_items').delete().eq('order_id', f.orderId)

    const res = await callPayMock(f.token, {})
    const row = await reservationRow(f.reservationId)

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('ORDER_REQUIRED')
    expect(row.payment_confirmed_at).toBeNull()
    expect(row.status).toBe('hold')
  }, 60000)

  it('무회귀: final_amount=0 주문(쿠폰·포인트 전액)은 pay-mock 으로 확정된다', async () => {
    const f = await createSignedPaidOrder()
    // 전액 할인 상태를 서버 저장값으로 재현(쿠폰·포인트 전액 사용과 동일한 결과)
    const { error } = await admin.from('orders').update({ final_amount: 0 }).eq('id', f.orderId)
    expect(error).toBeNull()

    const res = await callPayMock(f.token, {})
    const row = await reservationRow(f.reservationId)

    expect(res.status).toBe(200)
    expect(row.payment_confirmed_at).not.toBeNull()
    expect(row.status).toBe('confirmed')
  }, 60000)
})

describe('C) pay-result — URL 금액이 서버 주문 금액과 다르면 토스 승인 전에 거부', () => {
  it('RED→GREEN: amount(URL) ≠ orders.final_amount → AMOUNT_MISMATCH 리다이렉트, 결제 기록·확정 없음', async () => {
    const f = await createSignedPaidOrder()
    expect(f.finalAmount).toBeGreaterThan(1)

    const url = new URL(`http://localhost/contract/${f.token}/pay-result?paymentKey=tdd_pk&orderId=CSHOT-tdd-${Date.now()}&amount=1&points=0`)
    let thrown: { status?: number; location?: string } | null = null
    try {
      await payResultLoad({ params: { token: f.token }, url } as unknown as Parameters<typeof payResultLoad>[0])
    } catch (e) {
      thrown = e as { status?: number; location?: string }
    }
    expect(thrown?.status).toBe(303)
    expect(thrown?.location ?? '').toContain('AMOUNT_MISMATCH')

    const { count } = await admin.from('payment_transactions').select('id', { count: 'exact', head: true }).eq('reservation_id', f.reservationId)
    expect(count ?? 0).toBe(0)
    expect((await reservationRow(f.reservationId)).payment_confirmed_at).toBeNull()
  }, 60000)
})

describe('D) pay-start — 계약서 결제 서버 사전등록(청구금액·토스 orderId는 서버가 발급)', () => {
  async function callPayStart(token: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await payStart({ params: { token }, request: new Request('http://localhost', { method: 'POST' }) } as unknown as Parameters<typeof payStart>[0])
    return { status: res.status, body: (await res.json()) as Record<string, unknown> }
  }

  it('유료 주문: 서버 저장 final_amount와 이 주문에 묶인 토스 orderId를 돌려준다', async () => {
    const f = await createSignedPaidOrder()
    const res = await callPayStart(f.token)
    expect(res.status).toBe(200)
    expect(res.body.finalAmount).toBe(f.finalAmount)
    expect(isAcceptedContractTossOrderId(String(res.body.tossOrderId), f.orderId)).toBe(true)
    expect(String(res.body.tossOrderId)).toMatch(new RegExp(`^CSHOT-${f.orderId}-`))
  }, 60000)

  it('0원 주문은 결제창 대상이 아니다(400 NOT_PAYABLE)', async () => {
    const f = await createSignedPaidOrder()
    await admin.from('orders').update({ final_amount: 0 }).eq('id', f.orderId)
    const res = await callPayStart(f.token)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('NOT_PAYABLE')
  }, 60000)

  it('알 수 없는 토큰은 404 INVALID_TOKEN', async () => {
    const res = await callPayStart('00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('INVALID_TOKEN')
  })

  it('pay-result: 다른 주문에 묶인 토스 orderId는 승인 전에 INVALID_ORDER_ID로 거부', async () => {
    const f = await createSignedPaidOrder()
    const url = new URL(`http://localhost/contract/${f.token}/pay-result?paymentKey=tdd_pk&orderId=CSHOT-${f.orderId + 99999}-abcdef12&amount=${f.finalAmount}`)
    let thrown: { status?: number; location?: string } | null = null
    try {
      await payResultLoad({ params: { token: f.token }, url } as unknown as Parameters<typeof payResultLoad>[0])
    } catch (e) {
      thrown = e as { status?: number; location?: string }
    }
    expect(thrown?.status).toBe(303)
    expect(thrown?.location ?? '').toContain('INVALID_ORDER_ID')
    const { count } = await admin.from('payment_transactions').select('id', { count: 'exact', head: true }).eq('reservation_id', f.reservationId)
    expect(count ?? 0).toBe(0)
  }, 60000)

  it('토스 orderId 형식: 신규(주문id 일치)만 허용, 레거시(13자리)·다른 주문·임의 문자열 거부', () => {
    expect(isAcceptedContractTossOrderId('CSHOT-46-abcdef12', 46)).toBe(true)
    expect(isAcceptedContractTossOrderId('CSHOT-1791031067129', 46)).toBe(false) // 구 클라이언트 생성 형식은 배포 직후 제거됨
    expect(isAcceptedContractTossOrderId('CSHOT-47-abcdef12', 46)).toBe(false)
    expect(isAcceptedContractTossOrderId('anything', 46)).toBe(false)
    expect(isAcceptedContractTossOrderId('CSHOT-46-ab', 46)).toBe(false)
  })
})

describe('E) 포인트 차감 순서·잔액 부족 보정 (sp3 M-2)', () => {
  async function setPoints(f: Fixture, balance: number, orderPoints: number, orderFinal: number): Promise<void> {
    await admin.from('user_profiles').update({ points: balance }).eq('id', f.userId)
    await admin.from('orders').update({ selected_points: orderPoints, final_amount: orderFinal }).eq('id', f.orderId)
    cleanups.push(async () => { await admin.from('point_transactions').delete().eq('user_id', f.userId) })
  }
  async function balanceOf(userId: string): Promise<number> {
    const { data } = await admin.from('user_profiles').select('points').eq('id', userId).single()
    return Number((data as { points: number }).points)
  }
  async function useTxCount(userId: string): Promise<number> {
    const { count } = await admin.from('point_transactions').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('type', 'use')
    return count ?? 0
  }

  it('0원 확정(pay-mock): 포인트를 먼저 차감한 뒤 확정하고, 재호출해도 이중 차감하지 않는다', async () => {
    const f = await createSignedPaidOrder()
    await setPoints(f, 500, 500, 0)

    const res = await callPayMock(f.token, {})
    expect(res.status).toBe(200)
    expect(res.body.pointsDeducted).toBe(500)
    expect(await balanceOf(f.userId)).toBe(0)
    expect((await reservationRow(f.reservationId)).status).toBe('confirmed')

    const again = await callPayMock(f.token, {})
    expect(again.status).toBe(200)
    expect(await balanceOf(f.userId)).toBe(0)
    expect(await useTxCount(f.userId)).toBe(1)
  }, 90000)

  it('0원 확정(pay-mock): 이중 클릭(동시 요청)해도 포인트는 한 번만 차감된다', async () => {
    const f = await createSignedPaidOrder()
    await setPoints(f, 1500, 500, 0)

    const [a, b] = await Promise.all([callPayMock(f.token, {}), callPayMock(f.token, {})])
    expect([a.status, b.status].every((x) => x === 200 || x === 409)).toBe(true)
    expect(await balanceOf(f.userId)).toBe(1000)
    expect(await useTxCount(f.userId)).toBe(1)
    expect((await reservationRow(f.reservationId)).status).toBe('confirmed')
  }, 90000)

  it('0원 확정(pay-mock): 보유 포인트가 부족하면 확정하지 않고 주문을 현재 잔액으로 재보정(409 POINTS_ADJUSTED)', async () => {
    const f = await createSignedPaidOrder()
    await setPoints(f, 0, 500, 0) // 신청 이후 잔액이 0이 된 상황

    const res = await callPayMock(f.token, {})
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('POINTS_ADJUSTED')

    const row = await reservationRow(f.reservationId)
    expect(row.status).toBe('hold')
    expect(row.payment_confirmed_at).toBeNull()
    const { data: o } = await admin.from('orders').select('selected_points, final_amount').eq('id', f.orderId).single()
    expect(Number((o as { selected_points: number }).selected_points)).toBe(0)
    expect(Number((o as { final_amount: number | string }).final_amount)).toBeGreaterThan(0)
    expect(await useTxCount(f.userId)).toBe(0)
  }, 90000)

  it('pay-start: 보유 포인트가 저장된 사용 포인트보다 적으면 결제창 전에 재보정하고 pointsAdjusted를 알린다', async () => {
    const f = await createSignedPaidOrder()
    await setPoints(f, 0, 500, f.finalAmount - 500)

    const res = await callPayStartLocal(f.token)
    expect(res.status).toBe(200)
    expect(res.body.pointsAdjusted).toBe(true)
    expect(res.body.finalAmount).toBe(f.finalAmount) // 포인트 0 → 원래 금액
    const { data: o } = await admin.from('orders').select('selected_points').eq('id', f.orderId).single()
    expect(Number((o as { selected_points: number }).selected_points)).toBe(0)
  }, 90000)

  it('pay-start: 잔액이 충분하면 변경 없이 pointsAdjusted=false', async () => {
    const f = await createSignedPaidOrder()
    await setPoints(f, 1000, 500, f.finalAmount - 500)

    const res = await callPayStartLocal(f.token)
    expect(res.status).toBe(200)
    expect(res.body.pointsAdjusted).toBe(false)
    expect(res.body.finalAmount).toBe(f.finalAmount - 500)
  }, 90000)
})

describe('B) confirm_order_payment_and_update_reservations — 실제 주문의 결제금액 불일치 거부', () => {
  it('RED→GREEN: 실제 주문의 final_amount ≠ p_paid_amount 이면 거부(결제 기록·확정 없음)', async () => {
    const f = await createSignedPaidOrder()
    expect(f.finalAmount).toBeGreaterThan(1)

    const tossOrderId = `CSHOT-tdd-${Date.now()}`
    const { data, error } = await admin.rpc('confirm_order_payment_and_update_reservations', {
      p_order_id: f.orderId,
      p_reservation_ids: [f.reservationId],
      p_payment_key: 'tdd_payment_key',
      p_toss_order_id: tossOrderId,
      p_idempotency_key: tossOrderId,
      p_total_amount: f.finalAmount,
      p_paid_amount: 1, // 실제 청구액보다 훨씬 적은 금액
    })

    const rejected = error !== null || (data as { success?: boolean } | null)?.success === false
    expect(rejected).toBe(true)

    const { count } = await admin.from('payment_transactions').select('id', { count: 'exact', head: true }).eq('reservation_id', f.reservationId)
    expect(count ?? 0).toBe(0)
    expect((await reservationRow(f.reservationId)).payment_confirmed_at).toBeNull()
  }, 60000)

  it('무회귀: p_paid_amount = final_amount 이면 정상 확정', async () => {
    const f = await createSignedPaidOrder()
    const tossOrderId = `CSHOT-tdd-ok-${Date.now()}`
    const { data, error } = await admin.rpc('confirm_order_payment_and_update_reservations', {
      p_order_id: f.orderId,
      p_reservation_ids: [f.reservationId],
      p_payment_key: 'tdd_payment_key_ok',
      p_toss_order_id: tossOrderId,
      p_idempotency_key: tossOrderId,
      p_total_amount: f.finalAmount,
      p_paid_amount: f.finalAmount,
    })
    expect(error).toBeNull()
    expect((data as { success?: boolean } | null)?.success).toBe(true)
  }, 60000)
})
