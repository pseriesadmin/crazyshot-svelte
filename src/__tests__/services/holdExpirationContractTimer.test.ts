import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

/**
 * Stage 4 — HOLD D-1 타이머 리셋(GREATEST 방식) TDD (EC-5)
 * Harness Flow v3.2 — RED → GREEN → REFACTOR
 *
 * 대상: release_reservation_hold() — Migration 394 (D-1 NOT EXISTS → GREATEST 교체)
 *
 * 정합기준(GATE B Q6, EC-5):
 *   EC-5a: 계약서 미발송 hold — created_at 기준 30분 만료 (기존 동작 유지)
 *   EC-5b: 계약서 발송 1시간 전 + created_at 2시간 전 → GREATEST(2h,1h)=1h > 30min → 만료
 *          (OLD NOT EXISTS: 영구 제외돼 never expire — 이 동작이 RED 확인 지점)
 *   EC-5c: payment_confirmed_at IS NOT NULL → D-3 예외 유지, 만료 안 됨
 *
 * 핵심 불변식:
 *   D-3(결제완료 예외)는 이번 변경에서 절대 건드리지 않는다.
 *   D-1의 변경은 "영구 제외"에서 "타이머 리셋"으로만 좁힌다.
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

describe('release_reservation_hold — D-1 타이머 리셋(GREATEST) + D-3 불변 (EC-5)', () => {

  // ── EC-5a: 계약서 미발송 → created_at 기준 30분 만료 (기존 동작 유지) ───────
  it('EC-5a: 계약서 미발송 + created_at 40분 전 → expired 전환', async () => {
    const userId = await createEphemeralUser()
    cleanups.push(() => deleteEphemeralUser(userId))

    const fortyMinAgo = new Date(Date.now() - 40 * 60 * 1000)
    const reservationId = await createHoldReservation(userId, fortyMinAgo)
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId)
    })

    await admin.rpc('release_reservation_hold', {})

    expect(await getStatus(reservationId)).toBe('expired')
  })

  // ── EC-5b: D-1 타이머 리셋 — 계약서 발송 1시간 전 → GREATEST 기준 만료 ────
  // OLD D-1(NOT EXISTS): 영구 제외 → hold 유지 (이게 RED 포인트)
  // NEW D-1(GREATEST):   GREATEST(2h, 1h) = 1h > 30min → expired
  it('EC-5b: 계약서 발송됐지만 sent_at 기준 30분 초과 → expired 전환 (D-1 GREATEST)', async () => {
    const userId = await createEphemeralUser()
    cleanups.push(() => deleteEphemeralUser(userId))

    const twoHoursAgo = new Date(Date.now() - 120 * 60 * 1000)
    const oneHourAgo  = new Date(Date.now() -  60 * 60 * 1000)

    const reservationId = await createHoldReservation(userId, twoHoursAgo)
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId)
    })

    await createContractWithSigning(reservationId, userId, oneHourAgo)

    await admin.rpc('release_reservation_hold', {})

    // OLD: 영구 제외 → 'hold' (RED)
    // NEW: GREATEST(2h, 1h) = 1h > 30min → 'expired' (GREEN)
    expect(await getStatus(reservationId)).toBe('expired')
  })

  // ── 경계값: 계약서 발송 15분 전 → GREATEST(40min, 15min)=15min < 30min → 생존 ─
  it('EC-5b-edge: 계약서 발송 15분 전 → sent_at 기준 30분 이내 → hold 유지', async () => {
    const userId = await createEphemeralUser()
    cleanups.push(() => deleteEphemeralUser(userId))

    const fortyMinAgo  = new Date(Date.now() - 40 * 60 * 1000)
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
