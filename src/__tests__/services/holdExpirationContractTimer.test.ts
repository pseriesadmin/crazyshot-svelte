import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

/**
 * Stage 4 — HOLD 만료 정책 전면 개편 이후의 D-1(계약발송 타이머)·D-3(결제완료 예외) TDD (EC-5)
 * Harness Flow v3.2 — RED → GREEN → REFACTOR
 *
 * 대상: release_reservation_hold() — Migration 453 (2026-09-07, Stephen 확정 — "생성 후 30분"
 * 타이머 자체를 없애고 "계약 발송 시각(sent_at) 기준 30분"만 남김)
 *
 * 정합기준(GATE B Q6, EC-5 — 2026-09-07 정책 반전에 맞춰 갱신):
 *   EC-5a: 계약서 미발송 hold — created_at이 아무리 오래돼도 만료되지 않는다(타이머 자체 없음,
 *          이전 정책의 "생성 후 30분 만료"를 완전히 반전).
 *   EC-5b: 계약서가 발송(sent_at)되고 그 시각 기준 30분 초과 → expired 전환.
 *          (이 케이스를 실제로 검증하려면 release_reservation_hold()의 D-1 서브쿼리가 요구하는
 *           order_items 연결이 반드시 있어야 한다 — 연결이 없으면 계약을 아예 "발견"하지
 *           못해 검증 자체가 무의미해지므로 create_reservation_order RPC로 명시적으로 연결한다.)
 *   EC-5b-edge: 계약서 발송 후 30분 이내 → hold 유지(경계값).
 *   EC-5c: payment_confirmed_at IS NOT NULL → D-3 예외 유지, 만료 안 됨(변경 없음).
 *
 * 핵심 불변식:
 *   D-3(결제완료 예외)는 이번 변경에서 절대 건드리지 않는다.
 *   D-1은 이제 "타이머 리셋"이 아니라 "타이머의 유일한 시작점"이다 — created_at은 더 이상
 *   어떤 형태로도 만료 판정에 관여하지 않는다.
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn()
  }
})

function randomFutureDateRange() {
  const dayOffset = Math.floor(Math.random() * 3650) + 7300
  const start = new Date(Date.UTC(2030, 0, 1) + dayOffset * 86400000)
  const end = new Date(start.getTime() + 2 * 86400000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { start: fmt(start), end: fmt(end) }
}

async function ensureTestProductId(): Promise<string> {
  const { data, error } = await admin
    .from('products')
    .select('id')
    .is('parent_product_id', null)
    .limit(1)
    .single()
  if (error || !data) throw new Error(`테스트용 product 조회 실패: ${error?.message}`)
  return data.id as string
}

async function createEphemeralUser(): Promise<string> {
  const email = `tdd-holdtimer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'Test1234!',
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`)
  return data.user.id
}

async function deleteEphemeralUser(userId: string): Promise<void> {
  await admin.auth.admin.deleteUser(userId).catch(() => undefined)
}

async function createHoldReservation(
  userId: string,
  createdAt: Date,
  opts: { paymentConfirmedAt?: Date } = {},
): Promise<number> {
  const productId = await ensureTestProductId()
  const { start, end } = randomFutureDateRange()
  const { data, error } = await admin
    .from('rental_reservations')
    .insert({
      user_id:       userId,
      product_id:    productId,
      start_date:    start,
      end_date:      end,
      status:        'hold',
      pickup_method: 'visit',
      return_method: 'visit',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`reservation 생성 실패: ${error?.message}`)
  const id = data.id as number

  const updatePayload: Record<string, string> = { created_at: createdAt.toISOString() }
  if (opts.paymentConfirmedAt) {
    updatePayload.payment_confirmed_at = opts.paymentConfirmedAt.toISOString()
  }

  const { error: updErr } = await admin
    .from('rental_reservations')
    .update(updatePayload)
    .eq('id', id)
  if (updErr) throw new Error(`created_at 조작 실패: ${updErr.message}`)

  return id
}

// release_reservation_hold()의 D-1 서브쿼리는 "같은 주문(order_items) 형제 예약 중 계약이
// 발송된 것이 있는지"를 기준으로 삼는다 — order_items 연결이 없으면 계약이 있어도 절대
// "발견"되지 않는다(주문 전체 형제 대조용 자기조인이 애초에 빈 집합을 반환). 실제 체크아웃
// 흐름(cart/+page.svelte)이 쓰는 것과 동일한 create_reservation_order RPC로 연결한다.
async function linkToOrder(userId: string, reservationId: number): Promise<void> {
  const { error } = await admin.rpc('create_reservation_order', {
    p_user_id: userId,
    p_reservation_ids: [reservationId],
  })
  if (error) throw new Error(`create_reservation_order 실패: ${error.message}`)
  cleanups.push(async () => {
    await admin.from('order_items').delete().eq('reservation_id', reservationId)
  })
}

async function createContractWithSigning(
  reservationId: number,
  userId: string,
  sentAt: Date,
): Promise<void> {
  const { data: contract, error: cErr } = await admin
    .from('contracts')
    .insert({
      reservation_id: reservationId,
      user_id:        userId,
      contract_type:  'rental',
      status:         'active',
    })
    .select('id')
    .single()
  if (cErr || !contract) throw new Error(`contract 생성 실패: ${cErr?.message}`)

  const { error: sErr } = await admin
    .from('contract_signings')
    .insert({
      contract_id: contract.id as string,
      user_id:     userId,
      sent_at:     sentAt.toISOString(),
    })
  if (sErr) throw new Error(`contract_signing 생성 실패: ${sErr?.message}`)

  cleanups.push(async () => {
    await admin.from('contracts').delete().eq('id', contract.id as string)
  })
}

async function getStatus(reservationId: number): Promise<string | null> {
  const { data } = await admin
    .from('rental_reservations')
    .select('status')
    .eq('id', reservationId)
    .single()
  return (data?.status as string | undefined) ?? null
}

describe('release_reservation_hold — D-1(계약발송 타이머, 유일한 시작점) + D-3 불변 (EC-5)', () => {

  // ── EC-5a(2026-09-07 반전): 계약서 미발송 → 생성 후 아무리 오래돼도 만료되지 않는다 ──
  it('EC-5a: 계약서 미발송 + created_at 40분 전 → hold 그대로 유지(구 정책 반전)', async () => {
    const userId = await createEphemeralUser()
    cleanups.push(() => deleteEphemeralUser(userId))

    const fortyMinAgo = new Date(Date.now() - 40 * 60 * 1000)
    const reservationId = await createHoldReservation(userId, fortyMinAgo)
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId)
    })

    await admin.rpc('release_reservation_hold', {})

    expect(await getStatus(reservationId)).toBe('hold')
  })

  // ── EC-5b: 계약서 발송 1시간 전 → sent_at 기준 30분 초과 → expired ─────────
  it('EC-5b: 계약서 발송(sent_at) 1시간 전 → 30분 초과로 expired 전환', async () => {
    const userId = await createEphemeralUser()
    cleanups.push(() => deleteEphemeralUser(userId))

    const twoHoursAgo = new Date(Date.now() - 120 * 60 * 1000)
    const oneHourAgo  = new Date(Date.now() -  60 * 60 * 1000)

    const reservationId = await createHoldReservation(userId, twoHoursAgo)
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId)
    })

    await linkToOrder(userId, reservationId)
    await createContractWithSigning(reservationId, userId, oneHourAgo)

    await admin.rpc('release_reservation_hold', {})

    expect(await getStatus(reservationId)).toBe('expired')
  })

  // ── 경계값: 계약서 발송 15분 전 → 30분 이내 → 생존 ──────────────────────────
  it('EC-5b-edge: 계약서 발송(sent_at) 15분 전 → 30분 이내 → hold 유지', async () => {
    const userId = await createEphemeralUser()
    cleanups.push(() => deleteEphemeralUser(userId))

    const fortyMinAgo  = new Date(Date.now() - 40 * 60 * 1000)
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000)

    const reservationId = await createHoldReservation(userId, fortyMinAgo)
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId)
    })

    await linkToOrder(userId, reservationId)
    await createContractWithSigning(reservationId, userId, fifteenMinAgo)

    await admin.rpc('release_reservation_hold', {})

    expect(await getStatus(reservationId)).toBe('hold')
  })

  // ── EC-6(CMS 전역 전수검증 2026-09-09) — self-join 자기매칭 결함 ───────────────
  // 장바구니 체크아웃 제출(create_reservation_order) 전에는 order_items 연결이 없는 게
  // 정상이다(service-operations.md §4) — 그 상태에서도 계약서는 발송 가능하다
  // (rental-lifecycle.md "hold 포함 모든 상태에서 계약서 발송 가능"). D-1 서브쿼리가
  // "형제 예약을 찾는" self-join(oi1.reservation_id = rr.id)에 의존하는데, order_items가
  // 아예 없으면 이 예약 자기 자신의 계약 발송 사실조차 찾지 못해 타이머가 영원히
  // 시작되지 않던 결함(EC-5b/EC-5b-edge는 linkToOrder를 호출해 이 결함을 우회하고
  // 있었음 — 그래서 지금까지 발견되지 않았다).
  it('EC-6: order_items 미연결(체크아웃 제출 전) + 계약서 발송 1시간 전 → self-join이 자기 자신을 찾아 정상 expired 전환된다', async () => {
    const userId = await createEphemeralUser()
    cleanups.push(() => deleteEphemeralUser(userId))

    const twoHoursAgo = new Date(Date.now() - 120 * 60 * 1000)
    const oneHourAgo  = new Date(Date.now() -  60 * 60 * 1000)

    const reservationId = await createHoldReservation(userId, twoHoursAgo)
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId)
    })

    // linkToOrder() 호출 없음 — 장바구니 체크아웃 제출 전 상태를 그대로 재현
    await createContractWithSigning(reservationId, userId, oneHourAgo)

    await admin.rpc('release_reservation_hold', {})

    expect(await getStatus(reservationId)).toBe('expired')
  })

  // ── EC-6-edge(회귀): order_items 미연결 + 계약서 발송 15분 전 → 30분 이내 → 생존 ──
  it('EC-6-edge: order_items 미연결 + 계약서 발송 15분 전 → 30분 이내라 hold 유지(회귀)', async () => {
    const userId = await createEphemeralUser()
    cleanups.push(() => deleteEphemeralUser(userId))

    const fortyMinAgo   = new Date(Date.now() - 40 * 60 * 1000)
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000)

    const reservationId = await createHoldReservation(userId, fortyMinAgo)
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId)
    })

    await createContractWithSigning(reservationId, userId, fifteenMinAgo)

    await admin.rpc('release_reservation_hold', {})

    expect(await getStatus(reservationId)).toBe('hold')
  })

  // ── EC-5c: D-3 불변 — payment_confirmed_at IS NOT NULL → 계약과 무관하게 보호 ─
  it('EC-5c: payment_confirmed_at 설정된 hold → D-3 예외로 만료 안 됨', async () => {
    const userId = await createEphemeralUser()
    cleanups.push(() => deleteEphemeralUser(userId))

    const twoHoursAgo = new Date(Date.now() - 120 * 60 * 1000)
    const reservationId = await createHoldReservation(userId, twoHoursAgo, {
      paymentConfirmedAt: new Date(Date.now() - 90 * 60 * 1000),
    })
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId)
    })

    await admin.rpc('release_reservation_hold', {})

    expect(await getStatus(reservationId)).toBe('hold')
  })
})
