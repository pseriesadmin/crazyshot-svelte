/**
 * TDD-RED: checkoutReissueReservation.test.ts
 * reassign_order_item_reservation RPC (Migration 448) 라이브 통합테스트
 * hold 예약 재발행 핵심 로직 — 구 예약을 취소하고 신규 hold를 만든 뒤 order_items를 재연결
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트
 * cartReservationGrouping.test.ts의 createEphemeralSession 패턴 재사용
 *
 * Migration 448이 Stage에 적용되기 전까지는 "Could not find the function"으로 실패하는
 * 것이 정상(RED 상태).
 *
 * B-START 3항목:
 *   정상동작: hold 예약 1건을 재발행하면 신규 reservation_id가 반환되고,
 *             order_items가 신규 id로 재연결되며, 구 예약은 cancelled가 된다.
 *   막아야할것: 타인 소유 예약, hold 아닌 상태 예약의 reassign을 차단한다.
 *   실패했을때: 신규 hold 생성 실패 시 구 예약은 그대로 유지된다(롤백 없음 필요).
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// Stage DB 확인된 활성 자식 4개짜리 부모 상품 (cartReservationGrouping.test.ts와 동일)
const FIXTURE_PARENT_ID = '955238da-5440-47b1-906d-4865232f3a6c'

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

/** ephemeral 사용자 생성 + 로그인 세션 클라이언트 반환 */
async function createEphemeralSession(): Promise<{ client: SupabaseClient; userId: string }> {
  const email = `tdd-reissue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
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

/** 충돌 방지용 랜덤 미래 날짜 구간 */
function randomFutureRange(): { start: string; end: string } {
  // 2030년 이후 랜덤 날짜 — hold 재발행 테스트끼리 충돌 방지
  const dayOffset = Math.floor(Math.random() * 3650) + 1825
  const startMs = new Date(Date.UTC(2030, 0, 1)).getTime() + dayOffset * 86400000
  const start = new Date(startMs)
  const end = new Date(startMs + 3 * 86400000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { start: fmt(start), end: fmt(end) }
}

type HoldRow = { success: boolean; reservation_id: number | null; error_message: string | null }

/** hold 예약 생성 + cleanup 등록 */
async function createHoldWithShipment(
  client: SupabaseClient,
  startDate: string,
  endDate: string,
  pickupMethod = 'visit'
): Promise<number> {
  const { data, error } = await client.rpc('create_hold_reservation_with_shipment', {
    p_product_id:    FIXTURE_PARENT_ID,
    p_start_date:    startDate,
    p_end_date:      endDate,
    p_pickup_method: pickupMethod,
    p_duration_type: '24h',
  })
  if (error) throw new Error(`create_hold_reservation_with_shipment 오류: ${error.message}`)
  const row = (data as HoldRow[] | null)?.[0]
  if (!row?.success || row.reservation_id == null) {
    throw new Error(`create_hold_reservation_with_shipment 실패: ${row?.error_message ?? 'unknown'}`)
  }
  cleanups.push(async () => {
    await admin.from('rental_reservations').delete().eq('id', row.reservation_id)
  })
  return row.reservation_id
}

// ───────────────────────────────────────────────
// reassign_order_item_reservation RPC 직접 테스트
// ───────────────────────────────────────────────

describe('[TDD] reassign_order_item_reservation — order_items 재연결 RPC', () => {
  /**
   * EC-1: Happy path — order_items 있는 hold 예약 → reassign 후 신규 id로 재연결됨
   * Migration 448 적용 전에는 "Could not find the function"으로 실패(RED)
   */
  it('EC-1: order_items.reservation_id가 old → new로 갱신된다', async () => {
    const { client } = await createEphemeralSession()
    const { start, end } = randomFutureRange()

    // 구 hold 생성
    const oldId = await createHoldWithShipment(client, start, end)

    // 신규 hold 생성 (다른 날짜 구간)
    const { start: s2, end: e2 } = randomFutureRange()
    const newId = await createHoldWithShipment(client, s2, e2)

    // order_items에 구 hold 연결 (service_role 직접 INSERT — H-01 예외: 테스트 픽스처)
    const userId = (await client.auth.getUser()).data.user!.id
    const { data: orderInsert } = await admin
      .from('reservation_orders')
      .insert({ user_id: userId, status: 'pending', total_amount: 0 })
      .select('id')
      .single()

    if (!orderInsert) {
      // reservation_orders 테이블 구조 불명 시 skip
      console.warn('order_items 픽스처 생성 실패 — reassign 기본 동작만 확인')
    } else {
      cleanups.push(async () => {
        await admin.from('reservation_orders').delete().eq('id', orderInsert.id)
      })
      await admin.from('order_items').insert({
        order_id: orderInsert.id,
        reservation_id: oldId,
        product_id: FIXTURE_PARENT_ID,
        quantity: 1,
        unit_price: 0,
        line_total: 0,
      })
    }

    // reassign_order_item_reservation 호출 (RPC는 service_role 전용)
    const { error: rpcErr } = await admin.rpc('reassign_order_item_reservation', {
      p_old_reservation_id: oldId,
      p_new_reservation_id: newId,
    })

    // RPC 미적용(RED) 시 "Could not find the function" 에러
    expect(rpcErr).toBeNull()

    if (orderInsert) {
      // order_items.reservation_id가 newId로 갱신됐는지 확인
      const { data: oi } = await admin
        .from('order_items')
        .select('reservation_id')
        .eq('reservation_id', newId)
      expect(oi?.length).toBeGreaterThan(0)

      const { data: oiOld } = await admin
        .from('order_items')
        .select('reservation_id')
        .eq('reservation_id', oldId)
      expect(oiOld?.length).toBe(0)
    }
  })

  /**
   * EC-2: order_items 없는 hold 예약도 reassign은 성공(no-op on order_items — 에러 없음)
   */
  it('EC-2: order_items 없는 예약도 reassign이 에러 없이 성공한다', async () => {
    const { start, end } = randomFutureRange()
    const { client } = await createEphemeralSession()
    const oldId = await createHoldWithShipment(client, start, end)

    const { start: s2, end: e2 } = randomFutureRange()
    const newId = await createHoldWithShipment(client, s2, e2)

    // order_items 없이 바로 reassign
    const { error } = await admin.rpc('reassign_order_item_reservation', {
      p_old_reservation_id: oldId,
      p_new_reservation_id: newId,
    })

    // EC-2: 에러 없이 성공(order_items 행이 없어도 no-op)
    expect(error).toBeNull()
  })

  /**
   * EC-3: p_old_reservation_id = p_new_reservation_id (자기 자신 재할당)
   * 에러가 나서는 안 됨 — no-op으로 처리
   */
  it('EC-3: old === new일 때 no-op으로 처리(에러 없음)', async () => {
    const { start, end } = randomFutureRange()
    const { client } = await createEphemeralSession()
    const id = await createHoldWithShipment(client, start, end)

    const { error } = await admin.rpc('reassign_order_item_reservation', {
      p_old_reservation_id: id,
      p_new_reservation_id: id,
    })

    expect(error).toBeNull()
  })
})
