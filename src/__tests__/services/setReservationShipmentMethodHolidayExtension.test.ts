/**
 * TDD: set_reservation_shipment_method — 휴무일 포함 배송 연장 재계산 결함 수정 검증
 * (Migration 508, 2026-09-19)
 *
 * 배경: create_hold_reservation은 상품상세 "예약하기" 흐름에서 방식(p_pickup_method/
 * p_return_method) 없이(NULL) 먼저 호출되고, 실제 방식은 이후 별도로
 * set_reservation_shipment_method가 저장한다. Migration 508 이전에는 이 함수가
 * pickup_method/return_method 컬럼만 갱신할 뿐 compute_holiday_extended_period를 다시
 * 호출하지 않아 pickup_holiday_extra_days/return_holiday_extra_days가 항상 0으로
 * 남았다(실제 결제금액 정본 compute_reservation_line_amount가 이 두 컬럼을 그대로 읽으므로
 * 휴무일 연장 50% 요금이 실제로는 한 번도 청구되지 않았음). Stage DB 실데이터로
 * 확인(크레이지샷배송을 쓴 최근 예약 15건 전부 0) — 이 테스트는 그 재발을 방지한다.
 *
 * 일요일은 delivery_cutoff_settings.enable_fixed_holidays=true(Stage 확인됨)면 항상
 * is_courier_holiday=true이므로, 특정 공휴일 데이터에 의존하지 않고 "월요일 수령"(전날=일요일)
 * 조합으로 결정적(deterministic)으로 재현한다.
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트 — createHoldReservationWithShipment.test.ts와
 * 동일한 ephemeral session 패턴 재사용.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// Stage DB 확인된 활성 자식 4개짜리 부모 상품(Canon RF 24-70mm F2.8L) — 다른 테스트 파일들과 공유
const FIXTURE_PARENT_ID = '955238da-5440-47b1-906d-4865232f3a6c'
const COURIER_METHOD = 'crazydelivery' // Stage 확인된 유일한 is_courier_dependent=true 방식
const NON_COURIER_METHOD = 'visit'

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

async function createEphemeralSession(): Promise<{ client: SupabaseClient; userId: string }> {
  const email = `tdd-shipment-holiday-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const password = 'Test1234!'
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`)
  const userId = data.user.id

  const asUser = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
  const { error: signInErr } = await asUser.auth.signInWithPassword({ email, password })
  if (signInErr) throw new Error(`ephemeral user 로그인 실패: ${signInErr.message}`)

  cleanups.push(async () => {
    await admin.auth.admin.deleteUser(userId)
  })
  return { client: asUser, userId }
}

/** 먼 미래의 "월요일" 수령일 + 이틀 뒤 반납일을 반환(전날=일요일, 결정적 재현용) */
function futureMondayRange(): { start: string; end: string } {
  const base = new Date(Date.UTC(2030, 0, 1))
  // 2030-01-01은 화요일(UTC) — 다음 월요일까지 이동 후 넉넉히 미래로 밀어 다른 테스트와 충돌 방지
  const dow = base.getUTCDay()
  const toMonday = (8 - dow) % 7 || 7
  base.setUTCDate(base.getUTCDate() + toMonday + Math.floor(Math.random() * 200) * 7) // 항상 월요일 유지(주 단위 이동)
  const start = base.toISOString().slice(0, 10)
  const end = new Date(base.getTime() + 2 * 86400000).toISOString().slice(0, 10)
  return { start, end }
}

async function createBareHold(client: SupabaseClient, start: string, end: string): Promise<number> {
  const { data, error } = await client.rpc('create_hold_reservation', {
    p_product_id: FIXTURE_PARENT_ID,
    p_start_date: start,
    p_end_date: end,
  })
  const row = Array.isArray(data) ? data[0] : data
  if (error || !row?.success) throw new Error(`create_hold_reservation 실패: ${error?.message ?? row?.error_message}`)
  return row.reservation_id as number
}

/** 3-param 레거시 오버로드(Migration 171)와의 PostgREST 모호성(PGRST203)을 피하기 위해
 * 항상 4개 이상의 named param을 넘긴다(실제 앱 호출부도 항상 pickup_time/return_time까지
 * 함께 넘김 — products/[id]/+page.svelte 참고). */
async function setShipmentMethod(
  client: SupabaseClient,
  args: { reservationId: number; pickupMethod: string; returnMethod: string; extra?: Record<string, unknown> },
) {
  return client.rpc('set_reservation_shipment_method', {
    p_reservation_id: args.reservationId,
    p_pickup_method: args.pickupMethod,
    p_return_method: args.returnMethod,
    p_pickup_time: '10:00',
    p_return_time: '10:00',
    ...args.extra,
  })
}

async function fetchReservation(reservationId: number) {
  const { data, error } = await admin
    .from('rental_reservations')
    .select('start_date, end_date, pickup_method, return_method, pickup_holiday_extra_days, return_holiday_extra_days')
    .eq('id', reservationId)
    .single()
  if (error) throw new Error(`예약 조회 실패: ${error.message}`)
  return data as {
    start_date: string; end_date: string
    pickup_method: string; return_method: string
    pickup_holiday_extra_days: number | null; return_holiday_extra_days: number | null
  }
}

describe('[TDD] set_reservation_shipment_method — 휴무일 연장 재계산(Migration 508)', () => {
  it('EC-1: 방식 없이 생성된 hold에 배송(crazydelivery)을 나중에 지정하면 전날 일요일만큼 연장된다', async () => {
    const { client } = await createEphemeralSession()
    const { start, end } = futureMondayRange()
    const reservationId = await createBareHold(client, start, end)
    cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', reservationId) })

    const before = await fetchReservation(reservationId)
    expect(before.pickup_holiday_extra_days ?? 0).toBe(0) // 생성 시점(방식 NULL)엔 연장 없음이 정상

    const { error } = await setShipmentMethod(client, {
      reservationId, pickupMethod: COURIER_METHOD, returnMethod: NON_COURIER_METHOD,
    })
    expect(error).toBeNull()

    const after = await fetchReservation(reservationId)
    expect(after.pickup_method).toBe(COURIER_METHOD)
    expect(after.pickup_holiday_extra_days).toBe(1) // 월요일 전날=일요일(휴무) → 1일 연장
    expect(after.return_holiday_extra_days ?? 0).toBe(0) // 반납은 non-courier라 연장 없음
    expect(after.start_date).toBe(new Date(new Date(start).getTime() - 86400000).toISOString().slice(0, 10))
    expect(after.end_date).toBe(end) // 반납일은 원래 그대로
  })

  it('EC-2: 방식을 배송→방문으로 되돌리면 연장이 정확히 복구된다(누적되지 않음)', async () => {
    const { client } = await createEphemeralSession()
    const { start, end } = futureMondayRange()
    const reservationId = await createBareHold(client, start, end)
    cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', reservationId) })

    await setShipmentMethod(client, {
      reservationId, pickupMethod: COURIER_METHOD, returnMethod: NON_COURIER_METHOD,
    })
    const extended = await fetchReservation(reservationId)
    expect(extended.pickup_holiday_extra_days).toBe(1)

    const { error } = await setShipmentMethod(client, {
      reservationId, pickupMethod: NON_COURIER_METHOD, returnMethod: NON_COURIER_METHOD,
    })
    expect(error).toBeNull()

    const reverted = await fetchReservation(reservationId)
    expect(reverted.pickup_holiday_extra_days ?? 0).toBe(0)
    expect(reverted.start_date).toBe(start) // 원래 요청했던 날짜로 정확히 복구
    expect(reverted.end_date).toBe(end)
  })

  it('EC-3: 같은 방식을 두 번 연속 지정해도 연장이 중복 누적되지 않는다(멱등)', async () => {
    const { client } = await createEphemeralSession()
    const { start, end } = futureMondayRange()
    const reservationId = await createBareHold(client, start, end)
    cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', reservationId) })

    await setShipmentMethod(client, {
      reservationId, pickupMethod: COURIER_METHOD, returnMethod: NON_COURIER_METHOD,
    })
    await setShipmentMethod(client, {
      reservationId, pickupMethod: COURIER_METHOD, returnMethod: NON_COURIER_METHOD,
      extra: { p_pickup_request_note: '문 앞에 놔주세요' }, // 무관한 필드 변경 — 동일 방식 재호출 시나리오
    })

    const after = await fetchReservation(reservationId)
    expect(after.pickup_holiday_extra_days).toBe(1) // 2가 아니라 여전히 1
  })

  it('EC-4: courier-dependent가 아닌 방식(방문↔방문)은 항상 연장 0, 날짜도 변경 없음', async () => {
    const { client } = await createEphemeralSession()
    const { start, end } = futureMondayRange()
    const reservationId = await createBareHold(client, start, end)
    cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', reservationId) })

    const { error } = await setShipmentMethod(client, {
      reservationId, pickupMethod: NON_COURIER_METHOD, returnMethod: NON_COURIER_METHOD,
    })
    expect(error).toBeNull()

    const after = await fetchReservation(reservationId)
    expect(after.pickup_holiday_extra_days ?? 0).toBe(0)
    expect(after.return_holiday_extra_days ?? 0).toBe(0)
    expect(after.start_date).toBe(start)
    expect(after.end_date).toBe(end)
  })
})
