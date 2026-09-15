import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

/**
 * updateStatus 액션 — 주문 전체 예약취소 / 계약취소 TDD (RED 단계)
 * Harness Flow v3.2 — RED → GREEN → REFACTOR
 *
 * 플랜: /Users/stevenmac/.claude/plans/launch-selected-element-element-tag-div-lexical-wand.md §2
 *
 * 배경:
 *   기존 updateStatus 액션의 "예약취소" 경로는 화면에 보이는 단일 reservation_id만 취소 처리해,
 *   같은 주문의 형제 예약은 confirmed 등 상태로 그대로 남는 버그가 있었다.
 *   또한 계약(contracts.status)이 'cancelled'로 갱신되지 않아 계약 관리에 정합성 문제가 있었다.
 *
 *   이번 수정 설계:
 *   1. cancel_reservation_payment RPC — 결제 있으면 주문 전체 전액환불 + 전 형제 cancelled
 *   2. 결제 없는 경우(PAYMENT_NOT_FOUND) — 새 헬퍼로 order_items 순회해 전 형제 cancelled
 *   3. contracts.status = 'cancelled' 플랫 변경(콘텐츠 보존) + contract_audit_log 기록
 *      (매니저 이상 권한이 있을 때만)
 *
 * 완료기준(B-START 3항목):
 *   정상동작: 형제 2개 이상 → 전부 cancelled + 전액환불 + contracts.status='cancelled'
 *   막아야할것: 결제 없는 거부(hold) — 환불/계약취소는 스킵, 상태전환만
 *   실패했을때: 형제 예약 하나가 살아남거나 계약이 active 상태로 방치
 *
 * EC-1: 형제 2개 confirmed + 결제 있음 → 전부 cancelled + 전액환불 + contracts.status='cancelled'
 *   🔴 RED: cancel_reservation_payment가 contracts.status를 갱신하지 않아 실패
 *
 * EC-2: 형제 2개 hold + 결제 없음 → PAYMENT_NOT_FOUND + 둘 다 cancelled
 *   🔴 RED: PAYMENT_NOT_FOUND 경로에서 형제 전체 취소 헬퍼가 없어 실패
 *
 * EC-3: 결제 없는 hold + 계약 있음 → PAYMENT_NOT_FOUND + contracts.status 변경 안 됨(정상 경계)
 *   ✅ 경계값 문서화(통과) — 결제 없는 경우 contracts는 건드리지 않는 것이 올바른 동작
 *
 * 픽스처 흐름:
 *   hold 생성 → create_reservation_order 연결(status='hold' 필수)
 *   → (EC-1만) confirmed 강제 설정 + payment_transactions 직접 INSERT
 *   → cancel_reservation_payment 호출 → 결과 검증
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

/** 날짜 충돌(rental_reservations_product_dates_excl) 회피 */
function randomFutureDateRange(offsetDays = 0): { start: string; end: string } {
  const base = new Date(Date.UTC(2099, 3, 1)) // 2099-04-01 base (revertReservationOrderToHold와 구간 분리)
  const start = new Date(base.getTime() + (offsetDays + Math.floor(Math.random() * 50)) * 86400000)
  const end = new Date(start.getTime() + 3 * 86400000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { start: fmt(start), end: fmt(end) }
}

async function ensureTestProduct(): Promise<string> {
  const { data, error } = await admin
    .from('products')
    .select('id')
    .is('parent_product_id', null)
    .eq('is_active', true)
    .limit(1)
    .single()
  if (error || !data) throw new Error(`테스트용 product 조회 실패: ${error?.message}`)
  return data.id as string
}

async function createEphemeralUser(): Promise<string> {
  const email = `tdd-cancelwide-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'Test1234!',
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`)
  cleanups.push(() =>
    admin.auth.admin.deleteUser(data.user.id).then(() => undefined).catch(() => undefined),
  )
  return data.user.id
}

async function createHoldReservation(
  userId: string,
  productId: string,
  dateRange: { start: string; end: string },
): Promise<number> {
  const { data, error } = await admin
    .from('rental_reservations')
    .insert({
      user_id: userId,
      product_id: productId,
      start_date: dateRange.start,
      end_date: dateRange.end,
      status: 'hold',
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

/** hold → confirmed + payment_confirmed_at 설정 */
async function markConfirmed(reservationId: number): Promise<void> {
  const { error } = await admin
    .from('rental_reservations')
    .update({
      status: 'confirmed',
      payment_confirmed_at: new Date().toISOString(),
    })
    .eq('id', reservationId)
  if (error) throw new Error(`confirmed 설정 실패: ${error.message}`)
}

/**
 * create_reservation_order — hold 상태의 예약들을 같은 주문으로 묶음
 * ⚠️ 반드시 markConfirmed 전에 호출해야 함(hold 상태만 허용)
 */
async function linkToOrder(userId: string, reservationIds: number[]): Promise<number> {
  const { error } = await admin.rpc('create_reservation_order', {
    p_user_id: userId,
    p_reservation_ids: reservationIds,
  })
  if (error) throw new Error(`create_reservation_order 실패: ${error.message}`)

  const { data: item } = await admin
    .from('order_items')
    .select('order_id')
    .eq('reservation_id', reservationIds[0])
    .single()
  const orderId = item?.order_id as number

  cleanups.push(async () => {
    for (const rid of reservationIds) {
      await admin.from('order_items').delete().eq('reservation_id', rid)
    }
    if (orderId) await admin.from('orders').delete().eq('id', orderId)
  })
  return orderId
}

/**
 * payment_transactions 직접 INSERT — 직접 결제 시뮬레이션
 * (cancel_reservation_payment RPC 테스트용 — 실제 Toss API 호출 없음)
 */
async function insertDonePayment(
  reservationId: number,
  userId: string,
): Promise<string> {
  const tossOrderId = `CZ-canceltest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { data, error } = await admin
    .from('payment_transactions')
    .insert({
      reservation_id: reservationId,
      user_id: userId,
      payment_key: `test-pkey-${Date.now()}`,
      order_id: tossOrderId,
      idempotency_key: `idem-canceltest-${Date.now()}`,
      total_amount: 60000,
      paid_amount: 60000,
      status: 'done',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`payment_transactions INSERT 실패: ${error?.message}`)
  const ptId = data.id as string
  cleanups.push(async () => {
    await admin.from('payment_transactions').delete().eq('id', ptId)
  })
  return ptId
}

/**
 * contract + contract_signing 생성
 */
async function createContract(
  reservationId: number,
  userId: string,
): Promise<string> {
  const { data, error } = await admin
    .from('contracts')
    .insert({
      reservation_id: reservationId,
      user_id: userId,
      contract_type: 'rental',
      status: 'active',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`contract 생성 실패: ${error?.message}`)
  const contractId = data.id as string
  cleanups.push(async () => {
    // contract_signings은 contracts FK cascade 삭제
    await admin.from('contracts').delete().eq('id', contractId)
  })
  return contractId
}

// ─────────────────────────────────────────────────────────────────────────────
// 테스트
// ─────────────────────────────────────────────────────────────────────────────

describe('updateStatus 예약취소 — 주문 전체 단위 처리 (TDD RED)', () => {
  it('EC-1: 형제 2개 confirmed + 결제 있음 → 전부 cancelled + 결제취소 + contracts.status=cancelled', async () => {
    const productId = await ensureTestProduct()
    const userId = await createEphemeralUser()
    const adminId = userId // 테스트 목적상 admin_id = user_id 재활용

    // ── 픽스처 ─────────────────────────────────────────────────────────────────
    const r1Date = randomFutureDateRange(0)
    const r2Date = randomFutureDateRange(100) // 겹치지 않도록 100일 뒤
    const rid1 = await createHoldReservation(userId, productId, r1Date)
    const rid2 = await createHoldReservation(userId, productId, r2Date)

    // create_reservation_order: hold 상태에서 먼저 묶기
    await linkToOrder(userId, [rid1, rid2])

    // 계약 생성 (형제 둘 다)
    const cid1 = await createContract(rid1, userId)
    const cid2 = await createContract(rid2, userId)

    // hold → confirmed + payment_transactions INSERT
    await markConfirmed(rid1)
    await markConfirmed(rid2)
    await insertDonePayment(rid1, userId) // 대표 예약에 결제 연결

    // ── 실행: cancel_reservation_payment RPC ──────────────────────────────────
    const { data: result, error: rpcError } = await admin.rpc('cancel_reservation_payment', {
      p_reservation_id: rid1,
      p_admin_id: adminId,
      p_cancel_reason: 'EC-1 테스트 취소',
    })
    expect(rpcError).toBeNull()
    expect(result).toBeTruthy()

    // ── 검증 1: cancel_reservation_payment 자체 동작 ─────────────────────────
    expect(result.success).toBe(true)

    // 두 형제 모두 cancelled (cancel_reservation_payment가 이미 처리)
    const { data: res1 } = await admin
      .from('rental_reservations')
      .select('status')
      .eq('id', rid1)
      .single()
    const { data: res2 } = await admin
      .from('rental_reservations')
      .select('status')
      .eq('id', rid2)
      .single()
    expect(res1?.status).toBe('cancelled')
    expect(res2?.status).toBe('cancelled')

    // payment_transactions.status = 'cancelled'
    const ptId = result.payment_id as string
    const { data: pt } = await admin
      .from('payment_transactions')
      .select('status')
      .eq('id', ptId)
      .single()
    expect(pt?.status).toBe('cancelled')

    // ── 검증 2: contracts.status = 'cancelled' ────────────────────────────────
    // 🔴 RED: cancel_reservation_payment는 contracts.status를 갱신하지 않음
    //         updateStatus 서버 액션의 step-3 구현 후 GREEN이 되어야 함
    const { data: contract1 } = await admin
      .from('contracts')
      .select('status')
      .eq('id', cid1)
      .single()
    const { data: contract2 } = await admin
      .from('contracts')
      .select('status')
      .eq('id', cid2)
      .single()
    expect(contract1?.status).toBe('cancelled') // ← 🔴 현재 'active' 그대로 → FAIL
    expect(contract2?.status).toBe('cancelled') // ← 🔴 현재 'active' 그대로 → FAIL
  })

  it('EC-2: 형제 2개 hold + 결제 없음 → PAYMENT_NOT_FOUND + 둘 다 cancelled (현재 버그 확인)', async () => {
    const productId = await ensureTestProduct()
    const userId = await createEphemeralUser()
    const adminId = userId

    // ── 픽스처 ─────────────────────────────────────────────────────────────────
    const r1Date = randomFutureDateRange(200)
    const r2Date = randomFutureDateRange(300)
    const rid1 = await createHoldReservation(userId, productId, r1Date)
    const rid2 = await createHoldReservation(userId, productId, r2Date)

    // 주문으로 묶기 (payment 없이)
    await linkToOrder(userId, [rid1, rid2])
    // markConfirmed 호출 안 함 → 둘 다 hold 상태, 결제 없음

    // ── 실행: cancel_reservation_payment → PAYMENT_NOT_FOUND ─────────────────
    const { data: result, error: rpcError } = await admin.rpc('cancel_reservation_payment', {
      p_reservation_id: rid1,
      p_admin_id: adminId,
      p_cancel_reason: 'EC-2 테스트 거부',
    })
    expect(rpcError).toBeNull()

    // cancel_reservation_payment는 PAYMENT_NOT_FOUND를 반환 (결제 없음)
    expect(result?.success).toBe(false)
    expect(result?.error).toBe('PAYMENT_NOT_FOUND')

    // ── 검증: 두 형제 모두 cancelled ─────────────────────────────────────────
    // 🔴 RED: PAYMENT_NOT_FOUND 경로에서 rental_reservations를 전혀 건드리지 않으므로
    //         두 예약 모두 'hold' 상태 그대로 — 형제 전체 취소 헬퍼가 없어 실패
    const { data: res1 } = await admin
      .from('rental_reservations')
      .select('status')
      .eq('id', rid1)
      .single()
    const { data: res2 } = await admin
      .from('rental_reservations')
      .select('status')
      .eq('id', rid2)
      .single()
    expect(res1?.status).toBe('cancelled') // ← 🔴 현재 'hold' → FAIL
    expect(res2?.status).toBe('cancelled') // ← 🔴 현재 'hold' → FAIL
  })

  it('EC-3: 결제 없는 hold + 계약 있음 → PAYMENT_NOT_FOUND + contracts.status 변경 안 됨(정상 경계)', async () => {
    const productId = await ensureTestProduct()
    const userId = await createEphemeralUser()
    const adminId = userId

    // ── 픽스처 ─────────────────────────────────────────────────────────────────
    const r1Date = randomFutureDateRange(400)
    const rid1 = await createHoldReservation(userId, productId, r1Date)
    const cid1 = await createContract(rid1, userId)
    // 결제 없음 (payment_transactions INSERT 안 함)

    // ── 실행 ──────────────────────────────────────────────────────────────────
    const { data: result, error: rpcError } = await admin.rpc('cancel_reservation_payment', {
      p_reservation_id: rid1,
      p_admin_id: adminId,
      p_cancel_reason: 'EC-3 경계값 테스트',
    })
    expect(rpcError).toBeNull()
    expect(result?.success).toBe(false)
    expect(result?.error).toBe('PAYMENT_NOT_FOUND')

    // ── 검증: contracts.status는 'active' 그대로 유지(정상 — 결제 없는 경우 계약 건드리지 않음) ──
    const { data: contract } = await admin
      .from('contracts')
      .select('status')
      .eq('id', cid1)
      .single()
    expect(contract?.status).toBe('active') // ✅ 올바른 동작 — 결제 없는 경로에서 contracts 변경 없음
  })

  // ── EC-4: partner 경로 — update_reservation_status만 호출(환불·계약 취소 없음) ──
  // Defect 2 회귀 방지: hasSettingsAccess=false(partner) 경로는 환불 없이 상태전환만 수행해야 함.
  // 이 테스트는 서버 액션 직접 호출이 불가하므로 partner 경로와 동일한 DB 동작을 직접 시뮬레이션:
  //   - update_reservation_status를 각 형제에 직접 호출
  //   - contracts.status는 변경되지 않아야 함 (환불 없으므로 계약 취소 없음)
  //   - payment_transactions는 변경되지 않아야 함 (환불 없음)
  it('EC-4 (Defect 2 partner 경로): update_reservation_status만으로 형제 상태 전환 → contracts.status는 active 유지, payment_transactions는 done 유지', async () => {
    const productId = await ensureTestProduct()
    const userId = await createEphemeralUser()
    const adminId = userId

    // ── 픽스처 ─────────────────────────────────────────────────────────────────
    const r1Date = randomFutureDateRange(500)
    const r2Date = randomFutureDateRange(600)
    const rid1 = await createHoldReservation(userId, productId, r1Date)
    const rid2 = await createHoldReservation(userId, productId, r2Date)

    // 주문 연결 (hold 상태에서)
    await linkToOrder(userId, [rid1, rid2])

    // confirmed로 전환 + 결제 시뮬레이션
    await markConfirmed(rid1)
    await markConfirmed(rid2)
    const ptId = await insertDonePayment(rid1, userId)

    // 계약 생성 (contracts.status='active')
    const cid1 = await createContract(rid1, userId)
    const cid2 = await createContract(rid2, userId)

    // ── partner 경로 시뮬레이션: update_reservation_status만 직접 호출 ──
    // (Toss API 호출 없음 — hasSettingsAccess=false 경로는 환불 없이 상태만 변경)
    for (const rid of [rid1, rid2]) {
      const { data: sr, error: se } = await admin.rpc('update_reservation_status', {
        p_reservation_id: rid,
        p_new_status: 'cancelled',
      })
      expect(se).toBeNull()
      expect((sr as { ok: boolean } | null)?.ok).toBe(true)
    }

    // ── 검증 1: 두 예약 모두 cancelled ─────────────────────────────────────
    const { data: res1 } = await admin.from('rental_reservations').select('status').eq('id', rid1).single()
    const { data: res2 } = await admin.from('rental_reservations').select('status').eq('id', rid2).single()
    expect(res1?.status).toBe('cancelled')
    expect(res2?.status).toBe('cancelled')

    // ── 검증 2: contracts.status는 여전히 'active' (환불 없으므로 계약 취소 없음) ──
    const { data: c1 } = await admin.from('contracts').select('status').eq('id', cid1).single()
    const { data: c2 } = await admin.from('contracts').select('status').eq('id', cid2).single()
    expect(c1?.status).toBe('active') // partner 경로: 계약 취소 없음
    expect(c2?.status).toBe('active')

    // ── 검증 3: payment_transactions는 'done' 그대로 (환불 없음) ─────────────
    const { data: pt } = await admin.from('payment_transactions').select('status').eq('id', ptId).single()
    expect(pt?.status).toBe('done') // partner 경로: Toss API 미호출 → 결제 취소 없음
  })
})
