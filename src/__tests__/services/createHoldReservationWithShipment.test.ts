/**
 * TDD-RED: createHoldReservationWithShipment.test.ts
 * create_hold_reservation_with_shipment RPC (Migration 424) 라이브 통합테스트
 * (카트 수량(+) RPC 왕복 횟수 절감, 2026-09-02 Stephen 승인 — "2번" 대안)
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트 — cartReservationGrouping.test.ts와 동일
 * createEphemeralSession 패턴 재사용. create_hold_reservation/set_reservation_shipment_method/
 * set_reservation_duration 3개를 한 번에 묶은 RPC가 기존 앱단 3-스텝 로직과 동일한 결과를
 * 내는지 검증한다.
 *
 * Migration 424가 Stage에 적용되기 전까지는 "Could not find the function"으로 실패하는
 * 것이 정상(RED 상태).
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// Stage DB 확인된 활성 자식 4개짜리 부모 상품(Canon RF 24-70mm F2.8L) — 다른 테스트 파일들과 공유
const FIXTURE_PARENT_ID = '955238da-5440-47b1-906d-4865232f3a6c'

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

async function createEphemeralSession(): Promise<{ client: SupabaseClient; userId: string }> {
  const email = `tdd-hold-shipment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
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

function randomFutureRange(): { start: string; end: string } {
  const dayOffset = Math.floor(Math.random() * 3650) + 365
  const start = new Date(Date.UTC(2028, 0, 1) + dayOffset * 86400000)
  const end = new Date(start.getTime() + 2 * 86400000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { start: fmt(start), end: fmt(end) }
}

type ComboRow = { success: boolean; reservation_id: number | null; error_message: string | null }

async function createComboHold(
  client: SupabaseClient,
  args: {
    productId?: string
    start: string
    end: string
    pickupMethod?: string
    returnMethod?: string
    durationType?: string
  }
): Promise<ComboRow> {
  const { data, error } = await client.rpc('create_hold_reservation_with_shipment', {
    p_product_id: args.productId ?? FIXTURE_PARENT_ID,
    p_start_date: args.start,
    p_end_date: args.end,
    p_pickup_method: args.pickupMethod ?? 'visit',
    p_return_method: args.returnMethod ?? 'visit',
    p_pickup_time: null,
    p_return_time: null,
    p_duration_type: args.durationType ?? '24h',
  })
  if (error) throw new Error(`create_hold_reservation_with_shipment 오류: ${error.message}`)
  const row = (data as ComboRow[] | null)?.[0]
  if (!row) throw new Error('빈 결과')
  if (row.reservation_id != null) {
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', row.reservation_id)
    })
  }
  return row
}

describe('[TDD] create_hold_reservation_with_shipment — 성공 경로', () => {
  it('한 번의 호출로 hold 생성 + 수령/반납방식 + 대여기간유형이 전부 저장된다', async () => {
    const { client } = await createEphemeralSession()
    const { start, end } = randomFutureRange()

    const result = await createComboHold(client, {
      start, end,
      pickupMethod: 'visit',
      returnMethod: 'visit',
      durationType: '12h',
    })

    expect(result.success).toBe(true)
    expect(result.reservation_id).not.toBeNull()
    expect(result.error_message).toBeNull()

    const { data: row } = await admin
      .from('rental_reservations')
      .select('status, pickup_method, return_method, duration_type')
      .eq('id', result.reservation_id)
      .single()
    expect(row).toMatchObject({
      status: 'hold',
      pickup_method: 'visit',
      return_method: 'visit',
      duration_type: '12h',
    })
  })
})

describe('[TDD] create_hold_reservation_with_shipment — 실패 경로', () => {
  it('해당 기간에 재고가 없으면 실패하고 어떤 행도 생성되지 않는다', async () => {
    const { client } = await createEphemeralSession()
    const { start, end } = randomFutureRange()

    const result = await createComboHold(client, {
      productId: '00000000-0000-0000-0000-000000000000', // 존재하지 않는 부모상품 → 자식 없음
      start, end,
    })

    expect(result.success).toBe(false)
    expect(result.reservation_id).toBeNull()
    expect(result.error_message).toContain('예약 가능한 재고가 없습니다')
  })

  it('수령/반납 방식 저장이 실패하면 방금 생성한 hold를 취소하고 실패를 반환한다', async () => {
    const { client } = await createEphemeralSession()
    const { start, end } = randomFutureRange()

    // restrict_return_delivery를 켜고, is_bulk_delivery=true인 방식을 만들어 강제로
    // set_reservation_shipment_method의 RAISE EXCEPTION 경로를 유발한다.
    const { data: settingsRow } = await admin.from('rental_shipping_settings').select('id, restrict_return_delivery').limit(1).single()
    const settingsId = (settingsRow as { id: string }).id
    const originalRestricted = (settingsRow as { restrict_return_delivery: boolean | null }).restrict_return_delivery
    await admin.from('rental_shipping_settings').update({ restrict_return_delivery: true }).eq('id', settingsId)
    cleanups.push(async () => {
      await admin.from('rental_shipping_settings').update({ restrict_return_delivery: originalRestricted }).eq('id', settingsId)
    })

    const methodKey = `tdd-bulk-${Date.now()}`
    const { data: methodRow, error: methodErr } = await admin
      .from('rental_method_options')
      .insert({ method_key: methodKey, name: 'TDD 임시 배송방식', is_bulk_delivery: true, is_active: true })
      .select('id')
      .single()
    if (methodErr) throw new Error(`임시 배송방식 생성 실패: ${methodErr.message}`)
    cleanups.push(async () => {
      await admin.from('rental_method_options').delete().eq('id', (methodRow as { id: string }).id)
    })

    const before = await admin
      .from('rental_reservations')
      .select('id')
      .eq('user_id', (await client.auth.getUser()).data.user?.id)
    const beforeCount = (before.data ?? []).length

    const result = await createComboHold(client, { start, end, pickupMethod: methodKey })

    expect(result.success).toBe(false)
    expect(result.reservation_id).toBeNull()

    // hold 자체는 만들어졌었지만(내부적으로) cancelled로 취소됐는지 — 방금 생성된 신규 행만 확인
    const after = await admin
      .from('rental_reservations')
      .select('id, status, product_id')
      .eq('user_id', (await client.auth.getUser()).data.user?.id)
    const newRows = (after.data ?? []).filter(r => !(before.data ?? []).some(b => b.id === r.id))
    expect(newRows.length).toBe(1)
    expect(newRows[0].status).toBe('cancelled')
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', newRows[0].id)
    })
    expect(after.data?.length).toBe(beforeCount + 1)
  })

  it('대여기간유형 저장이 실패해도 hold 자체는 성공 유지되고 DURATION_SAVE_FAILED 접두사로 비차단 알림된다', async () => {
    const { client } = await createEphemeralSession()
    const { start, end } = randomFutureRange()

    const result = await createComboHold(client, {
      start, end,
      durationType: 'invalid-duration-type-value', // CHECK 제약 위반 유도
    })

    expect(result.success).toBe(true)
    expect(result.reservation_id).not.toBeNull()
    expect(result.error_message).toMatch(/^DURATION_SAVE_FAILED:/)

    const { data: row } = await admin
      .from('rental_reservations')
      .select('status')
      .eq('id', result.reservation_id)
      .single()
    expect((row as { status: string }).status).toBe('hold')
  })
})

describe('[TDD] create_hold_reservation_with_shipment — 인증 케이스', () => {
  // Migration 427(2026-09-03) — anon EXECUTE 권한 자체를 명시적으로 REVOKE했으므로, 이제
  // anon 호출은 함수 내부의 create_hold_reservation 비회원 차단 로직에 도달하기 전에
  // PostgREST 권한 레벨에서 차단된다(permission denied). 함수 자체가 authenticated 전용임을 검증한다.
  it('로그인 세션 없음(anon) → 함수 실행권한 자체가 없어 permission denied 에러', async () => {
    const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    const { start, end } = randomFutureRange()
    const { error } = await anon.rpc('create_hold_reservation_with_shipment', {
      p_product_id: FIXTURE_PARENT_ID,
      p_start_date: start,
      p_end_date: end,
      p_pickup_method: 'visit',
      p_return_method: 'visit',
      p_pickup_time: null,
      p_return_time: null,
      p_duration_type: '24h',
    })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/permission denied/i)
  })
})
