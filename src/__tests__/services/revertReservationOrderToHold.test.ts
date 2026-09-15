import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

/**
 * revert_reservation_order_to_hold RPC — TDD (Migration #492)
 * Harness Flow v3.2 — RED → GREEN → REFACTOR
 *
 * 플랜: /Users/stevenmac/.claude/plans/launch-selected-element-element-tag-div-lexical-wand.md §1
 *
 * 배경:
 *   "예약변경" 버튼 — confirmed(계약완료) 이후 예약을 hold(신청대기) 상태로 되돌려 재조정.
 *   하나의 예약 코드 = 여러 rental_reservations 행 → 주문(order) 전체 단위로 처리.
 *
 *   핵심 위험: revert 후 contract_signings.sent_at 을 NULL로 리셋하지 않으면,
 *   release_reservation_hold() pg_cron(매 1분, D-1 조건: sent_at 기준 30분 초과)이 되돌린
 *   hold를 1분 안에 expired로 자동 만료시킨다 — 예약변경 자체가 무의미해지는 치명적 회귀.
 *
 * 완료기준(B-START 3항목):
 *   정상동작: 형제 예약 전체가 hold로 복귀 + payment_confirmed_at NULL + contract_signings 리셋
 *   막아야할것: 이미 terminal(cancelled/completed/damage_claimed/expired)인 형제는 건드리지 않음
 *   실패했을때: cron 회귀 — release_reservation_hold() 직접 호출 후에도 hold 유지
 *
 * EC-1: 형제 2개 이상 주문 → 전부 hold 전환 + payment_confirmed_at NULL + contract_signings 리셋
 * EC-2: 형제 중 cancelled인 것은 건드리지 않음
 * EC-3: cron 회귀 — sent_at 리셋 직후 release_reservation_hold() 직접 호출해도 hold 유지 (가장 중요)
 * EC-4: 단건(형제 없음) 주문도 정상 동작
 *
 * 픽스처 흐름 (실제 체크아웃 흐름과 동일):
 *   hold 생성 → create_reservation_order 연결(status='hold' 필수) → 상태 UPDATE to confirmed
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

/** 날짜 충돌(rental_reservations_product_dates_excl) 회피를 위해 극히 먼 미래 날짜 사용 */
function randomFutureDateRange(offsetDays = 0): { start: string; end: string } {
  const base = new Date(Date.UTC(2099, 0, 1))
  const start = new Date(base.getTime() + (offsetDays + Math.floor(Math.random() * 50)) * 86400000)
  const end = new Date(start.getTime() + 3 * 86400000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { start: fmt(start), end: fmt(end) }
}

async function ensureTestProducts(count: number): Promise<string[]> {
  const { data, error } = await admin
    .from('products')
    .select('id')
    .is('parent_product_id', null)
    .limit(count)
  if (error || !data || data.length < count) {
    throw new Error(`테스트용 product ${count}개 조회 실패: ${error?.message}`)
  }
  return data.map((p) => p.id as string)
}

async function createEphemeralUser(): Promise<string> {
  const email = `tdd-revert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'Test1234!',
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`)
  cleanups.push(() => admin.auth.admin.deleteUser(data.user.id).then(() => undefined).catch(() => undefined))
  return data.user.id
}

/**
 * hold 예약 생성 — create_reservation_order는 status='hold' 필수이므로 hold로 먼저 생성
 */
async function createHoldReservation(
  userId: string,
  productId: string,
  dateRange: { start: string; end: string },
): Promise<number> {
  const { data, error } = await admin
    .from('rental_reservations')
    .insert({
      user_id:       userId,
      product_id:    productId,
      start_date:    dateRange.start,
      end_date:      dateRange.end,
      status:        'hold',
      pickup_method: 'visit',
      return_method: 'visit',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`hold reservation 생성 실패: ${error?.message}`)
  const id = data.id as number
  cleanups.push(async () => {
    await admin.from('rental_reservations').delete().eq('id', id)
  })
  return id
}

/**
 * hold → confirmed + payment_confirmed_at 설정 (결제 완료 시뮬레이션)
 */
async function markConfirmed(reservationId: number): Promise<void> {
  const { error } = await admin
    .from('rental_reservations')
    .update({
      status:               'confirmed',
      payment_confirmed_at: new Date().toISOString(),
    })
    .eq('id', reservationId)
  if (error) throw new Error(`confirmed 상태 업데이트 실패: ${error.message}`)
}

/**
 * hold → cancelled (terminal 시뮬레이션 — EC-2용)
 */
async function markCancelled(reservationId: number): Promise<void> {
  const { error } = await admin
    .from('rental_reservations')
    .update({ status: 'cancelled' })
    .eq('id', reservationId)
  if (error) throw new Error(`cancelled 상태 업데이트 실패: ${error.message}`)
}

/**
 * create_reservation_order RPC — 같은 order로 묶음
 * 이 함수는 status='hold'인 예약만 받으므로, markConfirmed/markCancelled 전에 호출해야 함
 */
async function linkToOrder(userId: string, reservationIds: number[]): Promise<void> {
  const { error } = await admin.rpc('create_reservation_order', {
    p_user_id:         userId,
    p_reservation_ids: reservationIds,
  })
  if (error) throw new Error(`create_reservation_order 실패: ${error.message}`)
  // cleanup: order_items → orders (cascade)
  cleanups.push(async () => {
    const { data: item } = await admin
      .from('order_items')
      .select('order_id')
      .eq('reservation_id', reservationIds[0])
      .maybeSingle()
    for (const rid of reservationIds) {
      await admin.from('order_items').delete().eq('reservation_id', rid)
    }
    if (item?.order_id) {
      await admin.from('orders').delete().eq('id', item.order_id as number)
    }
  })
}

/**
 * contract + contract_signing 생성 (sent_at 포함)
 * EC-3용: sent_at을 1시간 전으로 설정 → D-1 조건(30분 초과) 이미 충족되어 위험한 상태
 */
async function createContractWithSigning(
  reservationId: number,
  userId: string,
  opts: { sentAt?: Date; signedAt?: Date } = {},
): Promise<{ contractId: string; signingId: string }> {
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
  const contractId = contract.id as string

  const signingPayload: Record<string, string> = {
    contract_id: contractId,
    user_id:     userId,
  }
  if (opts.sentAt) signingPayload.sent_at = opts.sentAt.toISOString()
  if (opts.signedAt) signingPayload.signed_at = opts.signedAt.toISOString()

  const { data: signing, error: sErr } = await admin
    .from('contract_signings')
    .insert(signingPayload)
    .select('id')
    .single()
  if (sErr || !signing) throw new Error(`contract_signing 생성 실패: ${sErr?.message}`)
  const signingId = signing.id as string

  cleanups.push(async () => {
    // contract 삭제 시 contract_signings도 FK cascade로 삭제됨
    await admin.from('contracts').delete().eq('id', contractId)
  })
  return { contractId, signingId }
}

async function callRevertReservationOrderToHold(
  reservationId: number,
  adminId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await admin.rpc('revert_reservation_order_to_hold', {
    p_reservation_id: reservationId,
    p_admin_id:       adminId,
  })
  if (error) throw new Error(`revert_reservation_order_to_hold RPC 오류: ${error.message}`)
  return data as { ok: boolean; error?: string }
}

async function getReservation(id: number): Promise<{ status: string; payment_confirmed_at: string | null }> {
  const { data, error } = await admin
    .from('rental_reservations')
    .select('status, payment_confirmed_at')
    .eq('id', id)
    .single()
  if (error || !data) throw new Error(`reservation 조회 실패: ${error?.message}`)
  return data as { status: string; payment_confirmed_at: string | null }
}

async function getSigningSentAt(signingId: string): Promise<string | null> {
  const { data } = await admin
    .from('contract_signings')
    .select('sent_at')
    .eq('id', signingId)
    .maybeSingle()
  return (data?.sent_at as string | undefined) ?? null
}

describe('revert_reservation_order_to_hold — 예약변경 RPC (Migration #492)', () => {

  // ── EC-1: 형제 2개 → 전부 hold 전환 + payment_confirmed_at NULL + contract_signings.sent_at NULL ──
  it('EC-1: 형제 2개 confirmed → 전부 hold 전환, payment_confirmed_at NULL, contract_signings.sent_at NULL', async () => {
    const userId = await createEphemeralUser()
    const adminId = userId

    const productIds = await ensureTestProducts(2)
    const res1 = await createHoldReservation(userId, productIds[0], randomFutureDateRange(0))
    const res2 = await createHoldReservation(userId, productIds[1], randomFutureDateRange(200))

    // hold 상태일 때 주문으로 묶음
    await linkToOrder(userId, [res1, res2])

    // 이후 confirmed로 전환 (결제 완료)
    await markConfirmed(res1)
    await markConfirmed(res2)

    // 계약 발송 시뮬레이션
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const { signingId } = await createContractWithSigning(res1, userId, {
      sentAt:   oneHourAgo,
      signedAt: oneHourAgo,
    })

    // 🔴 RED: revert_reservation_order_to_hold RPC가 아직 없으므로 이 호출은 실패함
    const result = await callRevertReservationOrderToHold(res1, adminId)

    expect(result.ok).toBe(true)

    const s1 = await getReservation(res1)
    const s2 = await getReservation(res2)
    expect(s1.status).toBe('hold')
    expect(s2.status).toBe('hold')

    expect(s1.payment_confirmed_at).toBeNull()
    expect(s2.payment_confirmed_at).toBeNull()

    const sentAt = await getSigningSentAt(signingId)
    expect(sentAt).toBeNull()
  })

  // ── EC-2: 형제 중 cancelled인 것은 건드리지 않음 ──
  it('EC-2: 형제 중 cancelled 상태는 revert 후에도 cancelled 그대로 유지', async () => {
    const userId = await createEphemeralUser()
    const adminId = userId

    const productIds = await ensureTestProducts(2)
    const res1 = await createHoldReservation(userId, productIds[0], randomFutureDateRange(400))
    const res2 = await createHoldReservation(userId, productIds[1], randomFutureDateRange(600))

    // 두 예약 모두 hold 상태일 때 주문으로 묶음
    await linkToOrder(userId, [res1, res2])

    // res1: confirmed, res2: cancelled (terminal)
    await markConfirmed(res1)
    await markCancelled(res2)

    // 🔴 RED: RPC 없음
    const result = await callRevertReservationOrderToHold(res1, adminId)
    expect(result.ok).toBe(true)

    // res1: hold로 전환
    const s1 = await getReservation(res1)
    expect(s1.status).toBe('hold')

    // res2: cancelled 그대로 (terminal 상태는 건드리지 않음)
    const s2 = await getReservation(res2)
    expect(s2.status).toBe('cancelled')
  })

  // ── EC-3: cron 회귀 — sent_at 리셋 직후 release_reservation_hold() 호출해도 hold 유지 (가장 중요) ──
  it('EC-3 cron 회귀: revert 직후 release_reservation_hold() 호출해도 hold가 expired로 튕기지 않는다', async () => {
    const userId = await createEphemeralUser()
    const adminId = userId

    const productIds = await ensureTestProducts(1)
    const res1 = await createHoldReservation(userId, productIds[0], randomFutureDateRange(800))

    await linkToOrder(userId, [res1])
    await markConfirmed(res1)

    // sent_at을 1시간 전으로 설정 — D-1 조건(30분 초과)을 이미 충족하는 위험한 값.
    // revert RPC가 이 값을 NULL로 리셋하지 않으면 다음 cron 틱에서 즉시 expired 전환됨.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const { signingId } = await createContractWithSigning(res1, userId, {
      sentAt:   oneHourAgo,
      signedAt: oneHourAgo,
    })

    // 🔴 RED: RPC 없음
    const result = await callRevertReservationOrderToHold(res1, adminId)
    expect(result.ok).toBe(true)

    // revert 후 sent_at이 NULL인지 확인 (EC-3의 전제조건)
    const sentAt = await getSigningSentAt(signingId)
    expect(sentAt).toBeNull()

    // 🔑 가장 중요한 검증:
    // cron 함수(release_reservation_hold)를 직접 호출해도 expired가 되지 않아야 한다.
    // sent_at = NULL → D-1 조건(sent_at < NOW() - INTERVAL '30 minutes')이 FALSE(3치논리)
    // → 이 reservation은 만료 후보에서 자동 제외됨.
    await admin.rpc('release_reservation_hold', {})

    const s1 = await getReservation(res1)
    expect(s1.status).toBe('hold')  // expired가 아닌 hold 유지 — 실패 시 cron 회귀
  })

  // ── EC-4: 단건(형제 없음, order_items 없음) 주문도 정상 동작 ──
  it('EC-4: 형제 없는 단건 주문(order_items 없음)도 자기 자신을 hold로 복귀', async () => {
    const userId = await createEphemeralUser()
    const adminId = userId

    const productIds = await ensureTestProducts(1)
    const res1 = await createHoldReservation(userId, productIds[0], randomFutureDateRange(1000))
    // linkToOrder 호출하지 않음 — order_items 없음
    // 플랜 §1: "order_items.order_id 조회 → 없으면 자기 자신만 대상(레거시/단건)"
    await markConfirmed(res1)

    const { signingId } = await createContractWithSigning(res1, userId, {
      sentAt: new Date(Date.now() - 40 * 60 * 1000),
    })

    // 🔴 RED: RPC 없음
    const result = await callRevertReservationOrderToHold(res1, adminId)
    expect(result.ok).toBe(true)

    const s1 = await getReservation(res1)
    expect(s1.status).toBe('hold')
    expect(s1.payment_confirmed_at).toBeNull()

    const sentAt = await getSigningSentAt(signingId)
    expect(sentAt).toBeNull()
  })

  // ── EC-5: terminal 형제(cancelled)에 오래된 sent_at이 있어도 revert 후 cron이 hold를 만료시키지 않음 ──
  // Defect 3 회귀 방지: Migration #492의 step 4는 v_target_ids(non-terminal만)만 리셋했기 때문에,
  // cancelled 형제의 오래된 sent_at이 남아있으면 release_reservation_hold()의 MAX(sent_at)이
  // 그 오래된 값을 반환 → reverted hold가 즉시 expired로 전환됨.
  // Migration #499의 수정: step 4를 v_all_order_ids(terminal 포함 ALL)로 확장해 해소.
  it('EC-5 (Defect 3): terminal 형제(cancelled)에 오래된 sent_at이 있어도 revert 후 release_reservation_hold()가 hold를 만료시키지 않는다', async () => {
    const userId = await createEphemeralUser()
    const adminId = userId

    const productIds = await ensureTestProducts(2)
    const res1 = await createHoldReservation(userId, productIds[0], randomFutureDateRange(1200))
    const res2 = await createHoldReservation(userId, productIds[1], randomFutureDateRange(1400))

    // 두 예약을 같은 주문으로 묶음
    await linkToOrder(userId, [res1, res2])

    // res1: confirmed (revert 대상)
    // res2: cancelled (terminal — step 3에서 건드리지 않음)
    await markConfirmed(res1)
    await markCancelled(res2)

    // res1: confirmed + 계약 없음 (sent_at NULL → cron에서 이미 안전)
    // res2(cancelled): 오래된 sent_at 있는 계약 생성
    //   → Defect 3 핵심: step 4가 v_target_ids(non-terminal)만 순회하면
    //     res2의 old sent_at이 리셋 안 됨 → MAX(sent_at)이 res2의 옛 값을 반환
    //     → reverted hold(res1)이 즉시 expired로 전환되는 버그
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
    await createContractWithSigning(res2, userId, {
      sentAt:   twoHoursAgo,
      signedAt: twoHoursAgo,
    })

    // revert 호출 (res1 기준)
    const result = await callRevertReservationOrderToHold(res1, adminId)
    expect(result.ok).toBe(true)

    // res1이 hold로 전환됐는지 확인
    const s1 = await getReservation(res1)
    expect(s1.status).toBe('hold')

    // res2는 cancelled 그대로 (step 3 영향 없음)
    const s2 = await getReservation(res2)
    expect(s2.status).toBe('cancelled')

    // 🔑 핵심 검증: cron(release_reservation_hold) 직접 호출 후에도 res1이 hold를 유지해야 한다.
    // Defect 3 수정(Migration #499): res2(cancelled)의 contract_signings.sent_at도 NULL로 리셋됨
    // → MAX(sent_at) = NULL → D-1 조건이 FALSE → res1은 만료 후보에서 제외됨
    await admin.rpc('release_reservation_hold', {})

    const s1After = await getReservation(res1)
    expect(s1After.status).toBe('hold')  // 'expired'가 되면 Defect 3 회귀
  })
})
