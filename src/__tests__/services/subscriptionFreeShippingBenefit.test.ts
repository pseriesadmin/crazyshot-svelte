import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'

/**
 * 구독 "혜택관리" 4종 실적용 마스터플랜 Phase 5/6 — 무료배송(FREE_SHIPPING) (TDD)
 * apply_subscription_free_shipping RPC — Migration 542
 *
 * ⚠️ 이 RPC는 REVOKE ALL ... GRANT service_role 전용이라 반드시 adminClient(service role)로만
 * 호출한다(subscriptionBenefitCouponIssuance.test.ts와 동일 패턴).
 *
 * 범위(B-START):
 *   정상 동작 — 활성 구독 + FREE_SHIPPING 혜택이 켜진 유저가 실제로 배송(수령·반납 방식이
 *     is_delivery_type=true)이 포함된 예약묶음을 제출하면, 그 예약묶음의 배송형(왕복/편도)이
 *     혜택 설정(shipping_type)과 일치할 때 applies:true를 반환하고 subscription_benefit_usage에
 *     사용기록이 남는다. 같은 예약묶음으로 재호출하면 사용횟수를 추가로 소모하지 않고
 *     already_applied:true만 반환한다(멱등성).
 *   막아야 할 것 — 활성 구독이 없거나, 혜택이 꺼져있거나(is_enabled=false) 아예 설정되지
 *     않은 플랜, 배송형이 혜택 설정과 다른(왕복 혜택인데 편도 예약 등) 경우, 배송 자체가
 *     없는(수령·반납 둘 다 방문) 예약, 월 제한 횟수(monthly_limit)를 이미 채운 구독에는
 *     혜택이 적용되면 안 된다(deliveryFee가 실수로 0원 처리되면 안 됨).
 *   실패했을 때 — 각 차단 케이스는 예외를 던지지 않고 { applies: false, reason: ... } JSONB를
 *     반환한다(호출부 create-order/+server.ts가 fail-soft로 소비하는 계약과 일치 — 판정
 *     실패가 주문 생성 자체를 막지 않아야 함).
 *
 * ⛔ 이번 세션은 stage 마이그레이션 미적용 상태(RPC 자체가 아직 없음) — 아래 테스트는 전부
 * RED(함수 없음 PGRST202 에러 또는 그에 준하는 실패)로 먼저 확인하는 것이 정상이다. 메인
 * 세션이 Migration 542를 stage에 적용한 뒤 재실행하면 GREEN으로 전환되어야 한다.
 *
 * 배송형 판정 픽스처는 stage DB의 실제 rental_method_options 설정값을 그대로 사용한다
 * (임의 method_key를 새로 만들지 않음 — pickup_method/return_method는 shipment_method_enum
 * 실제 열거값만 허용):
 *   'crazydelivery' → is_delivery_type = true  (배송)
 *   'visit'         → is_delivery_type = false (배송 아님)
 * 이 두 값의 조합만으로 round_trip(둘 다 배송)/one_way(하나만 배송)/배송없음(둘 다 방문)
 * 3가지 경우를 전부 만들 수 있어 CMS 설정 데이터를 건드리지 않고 검증 가능하다.
 */

const adminClient = env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(getSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY)
  : null

type RpcResult = { data: Record<string, unknown> | null; error: { code?: string; message: string } | null }
const adminRpcCall = (fn: string, args: Record<string, unknown>): Promise<RpcResult> =>
  (adminClient!.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<RpcResult>)(fn, args)

// Stage DB 활성 자식 상품 — 여러 기존 테스트(couponEligibilityValidation.test.ts 등)가 공유하는
// NOT NULL product_id 픽스처. 이 상품 자체를 수정하지 않고 FK 값으로만 참조한다.
const FIXTURE_PRODUCT_ID = '12361ae3-5bbc-4da8-9fbb-8249241fab65'

let testUserIds: string[] = []

// 플랜 5종
let planRoundTrip: number // FREE_SHIPPING enabled, shipping_type='round_trip', monthly_limit=5
let planOneWay: number // FREE_SHIPPING enabled, shipping_type='one_way', monthly_limit=5
let planDisabled: number // FREE_SHIPPING is_enabled=false
let planNoBenefit: number // tier_benefits 행 자체 없음
let planFrequency: number // FREE_SHIPPING enabled, shipping_type='round_trip', monthly_limit=1

// 구독(user_subscriptions) — 각 플랜당 1개(userF는 구독 자체를 만들지 않음 — NO_ACTIVE_SUBSCRIPTION 전용)
let subRoundTrip: number
let subOneWay: number
let subDisabled: number
let subNoBenefit: number
let subFrequency: number

// 예약(rental_reservations) 픽스처 — 각 시나리오별 1건씩
let rtDeliveryReservationId: number // pickup=crazydelivery, return=crazydelivery (왕복 배송)
let mismatchReservationId: number // pickup=crazydelivery, return=visit (편도 — round_trip 플랜과 불일치)
let owDeliveryReservationId: number // pickup=crazydelivery, return=visit (편도 배송 — one_way 플랜과 일치)
let notDeliveryReservationId: number // pickup=visit, return=visit (배송 아님)
let freqReservationId1: number
let freqReservationId2: number

// rental_reservations_product_dates_excl(동일 product_id + 겹치는 날짜 범위) 배타 제약을
// 피하기 위해 픽스처마다 서로 겹치지 않는 날짜 구간을 순차 배정한다(같은 product_id 재사용,
// FK 값만 공유 — 실제 상품 데이터는 건드리지 않음).
let dateOffset = 0
async function createReservation(userId: string, pickupMethod: string, returnMethod: string): Promise<number> {
  const code = `RSV-FS-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
  const start = new Date(Date.UTC(2026, 9, 1 + dateOffset * 3))
  const end = new Date(Date.UTC(2026, 9, 3 + dateOffset * 3))
  dateOffset += 1
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const { data, error } = await adminClient!
    .from('rental_reservations')
    .insert({
      user_id: userId,
      reservation_code: code,
      product_id: FIXTURE_PRODUCT_ID,
      status: 'hold',
      pickup_method: pickupMethod,
      return_method: returnMethod,
      start_date: fmt(start),
      end_date: fmt(end),
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`reservation 생성 실패: ${JSON.stringify(error)}`)
  return (data as { id: number }).id
}

const createdReservationIds: number[] = []

beforeAll(async () => {
  if (!adminClient) throw new Error('SUPABASE_SERVICE_ROLE_KEY 미설정 — 테스트 실행 불가')

  const { data: userRows, error: userError } = await adminClient
    .from('user_profiles')
    .select('id')
    .order('id', { ascending: true })
    .limit(6)
  if (userError || !userRows || userRows.length < 6) {
    throw new Error('테스트용 user_profiles 픽스처 부족(최소 6건 필요) — 스테이지 DB 상태 확인 필요')
  }
  testUserIds = (userRows as { id: string }[]).map((r) => r.id)

  const makePlan = async (name: string): Promise<number> => {
    const { data, error } = await adminClient!
      .from('subscription_plans')
      .insert({ name: `__TEST_FREESHIP_${name}_${Date.now()}`, monthly_price: 9900, status: 'active' })
      .select('id')
      .single()
    if (error || !data) throw new Error(`플랜(${name}) 픽스처 생성 실패: ${error?.message}`)
    return (data as { id: number }).id
  }

  planRoundTrip = await makePlan('ROUNDTRIP')
  planOneWay = await makePlan('ONEWAY')
  planDisabled = await makePlan('DISABLED')
  planNoBenefit = await makePlan('NOBENEFIT')
  planFrequency = await makePlan('FREQUENCY')

  const insertBenefit = async (planId: number, isEnabled: boolean, params: Record<string, unknown>) => {
    const { error } = await adminClient!.from('tier_benefits').insert({
      plan_id: planId,
      benefit_type: 'FREE_SHIPPING',
      is_enabled: isEnabled,
      benefit_params: params,
    })
    if (error) throw new Error(`tier_benefits 픽스처 생성 실패(plan_id=${planId}): ${error.message}`)
  }

  await insertBenefit(planRoundTrip, true, { shipping_type: 'round_trip', monthly_limit: 5 })
  await insertBenefit(planOneWay, true, { shipping_type: 'one_way', monthly_limit: 5 })
  await insertBenefit(planDisabled, false, { shipping_type: 'round_trip', monthly_limit: 5 })
  // planNoBenefit — tier_benefits 행 없음(의도적으로 insertBenefit 호출 안 함)
  await insertBenefit(planFrequency, true, { shipping_type: 'round_trip', monthly_limit: 1 })

  const makeSub = async (planId: number, userId: string, suffix: string): Promise<number> => {
    const { data, error } = await adminClient!
      .from('user_subscriptions')
      .insert({
        user_id: userId,
        plan_id: planId,
        status: 'active',
        billing_key: `billing_FREESHIP_TEST_${Date.now()}_${suffix}`,
        billing_cycle_day: 1,
        fail_count: 0,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`user_subscriptions 픽스처 생성 실패(${suffix}): ${error?.message}`)
    return (data as { id: number }).id
  }

  subRoundTrip = await makeSub(planRoundTrip, testUserIds[0], 'roundtrip')
  subOneWay = await makeSub(planOneWay, testUserIds[1], 'oneway')
  subDisabled = await makeSub(planDisabled, testUserIds[2], 'disabled')
  subNoBenefit = await makeSub(planNoBenefit, testUserIds[3], 'nobenefit')
  subFrequency = await makeSub(planFrequency, testUserIds[4], 'frequency')
  // testUserIds[5] = userNoSub — 구독을 만들지 않음(NO_ACTIVE_SUBSCRIPTION 전용)

  rtDeliveryReservationId = await createReservation(testUserIds[0], 'crazydelivery', 'crazydelivery')
  mismatchReservationId = await createReservation(testUserIds[0], 'crazydelivery', 'visit')
  owDeliveryReservationId = await createReservation(testUserIds[1], 'crazydelivery', 'visit')
  notDeliveryReservationId = await createReservation(testUserIds[0], 'visit', 'visit')
  freqReservationId1 = await createReservation(testUserIds[4], 'crazydelivery', 'crazydelivery')
  freqReservationId2 = await createReservation(testUserIds[4], 'crazydelivery', 'crazydelivery')

  createdReservationIds.push(
    rtDeliveryReservationId,
    mismatchReservationId,
    owDeliveryReservationId,
    notDeliveryReservationId,
    freqReservationId1,
    freqReservationId2
  )
})

afterAll(async () => {
  if (!adminClient) return

  // FK 의존 순서: subscription_benefit_usage → rental_reservations →
  // (tier_benefits/user_subscriptions는 서로 무관) → user_subscriptions → subscription_plans
  const allSubIds = [subRoundTrip, subOneWay, subDisabled, subNoBenefit, subFrequency].filter(Boolean)
  if (allSubIds.length > 0) {
    await adminClient.from('subscription_benefit_usage').delete().in('user_subscription_id', allSubIds)
  }
  if (createdReservationIds.length > 0) {
    await adminClient.from('rental_reservations').delete().in('id', createdReservationIds)
  }
  if (allSubIds.length > 0) {
    await adminClient.from('user_subscriptions').delete().in('id', allSubIds)
  }
  const allPlanIds = [planRoundTrip, planOneWay, planDisabled, planNoBenefit, planFrequency].filter(Boolean)
  if (allPlanIds.length > 0) {
    await adminClient.from('tier_benefits').delete().in('plan_id', allPlanIds)
    await adminClient.from('subscription_plans').delete().in('id', allPlanIds)
  }
})

describe('apply_subscription_free_shipping — 정상 동작 + 멱등성 (Happy)', () => {
  it('RED: 왕복 배송 혜택이 켜진 구독은 왕복 배송 예약묶음에 적용되고, 같은 묶음 재호출 시 already_applied로 처리된다', async () => {
    const first = await adminRpcCall('apply_subscription_free_shipping', {
      p_user_id: testUserIds[0],
      p_reservation_ids: [rtDeliveryReservationId],
    })
    expect(first.error).toBeNull()
    expect(first.data?.applies).toBe(true)
    expect(first.data?.already_applied).not.toBe(true)

    const { data: usageRows } = await adminClient!
      .from('subscription_benefit_usage')
      .select('id')
      .eq('user_subscription_id', subRoundTrip)
      .eq('benefit_type', 'FREE_SHIPPING')
    expect((usageRows ?? []).length).toBe(1)

    // 같은 예약묶음으로 재호출 — 사용횟수 추가 소모 없이 already_applied:true만 반환
    const second = await adminRpcCall('apply_subscription_free_shipping', {
      p_user_id: testUserIds[0],
      p_reservation_ids: [rtDeliveryReservationId],
    })
    expect(second.error).toBeNull()
    expect(second.data?.applies).toBe(true)
    expect(second.data?.already_applied).toBe(true)

    const { data: usageRowsAfter } = await adminClient!
      .from('subscription_benefit_usage')
      .select('id')
      .eq('user_subscription_id', subRoundTrip)
      .eq('benefit_type', 'FREE_SHIPPING')
    expect((usageRowsAfter ?? []).length).toBe(1)
  })

  it('RED: 편도 배송 혜택이 켜진 구독은 편도 배송 예약묶음(수령만 배송)에 적용된다', async () => {
    const { data, error } = await adminRpcCall('apply_subscription_free_shipping', {
      p_user_id: testUserIds[1],
      p_reservation_ids: [owDeliveryReservationId],
    })
    expect(error).toBeNull()
    expect(data?.applies).toBe(true)

    const { data: usageRows } = await adminClient!
      .from('subscription_benefit_usage')
      .select('id')
      .eq('user_subscription_id', subOneWay)
      .eq('benefit_type', 'FREE_SHIPPING')
    expect((usageRows ?? []).length).toBe(1)
  })
})

describe('apply_subscription_free_shipping — 차단 케이스 (Edge/Error)', () => {
  it('RED: 배송형이 혜택 설정과 다르면(왕복 혜택 + 편도 예약) SHIPPING_TYPE_MISMATCH로 차단된다', async () => {
    const { data, error } = await adminRpcCall('apply_subscription_free_shipping', {
      p_user_id: testUserIds[0],
      p_reservation_ids: [mismatchReservationId],
    })
    expect(error).toBeNull()
    expect(data?.applies).toBe(false)
    expect(data?.reason).toBe('SHIPPING_TYPE_MISMATCH')
  })

  it('RED: 수령·반납 둘 다 배송이 아니면(방문/방문) NOT_DELIVERY로 차단된다', async () => {
    const { data, error } = await adminRpcCall('apply_subscription_free_shipping', {
      p_user_id: testUserIds[0],
      p_reservation_ids: [notDeliveryReservationId],
    })
    expect(error).toBeNull()
    expect(data?.applies).toBe(false)
    expect(data?.reason).toBe('NOT_DELIVERY')
  })

  it('RED: 활성 구독이 없으면 NO_ACTIVE_SUBSCRIPTION을 반환한다(예외를 던지지 않음)', async () => {
    const { data, error } = await adminRpcCall('apply_subscription_free_shipping', {
      p_user_id: testUserIds[5],
      p_reservation_ids: [],
    })
    expect(error).toBeNull()
    expect(data?.applies).toBe(false)
    expect(data?.reason).toBe('NO_ACTIVE_SUBSCRIPTION')
  })

  it('RED: 혜택이 꺼져있으면(is_enabled=false) BENEFIT_NOT_ENABLED로 차단된다', async () => {
    const { data, error } = await adminRpcCall('apply_subscription_free_shipping', {
      p_user_id: testUserIds[2],
      p_reservation_ids: [],
    })
    expect(error).toBeNull()
    expect(data?.applies).toBe(false)
    expect(data?.reason).toBe('BENEFIT_NOT_ENABLED')
  })

  it('RED: tier_benefits 행 자체가 없는 플랜은 BENEFIT_NOT_ENABLED로 차단된다', async () => {
    const { data, error } = await adminRpcCall('apply_subscription_free_shipping', {
      p_user_id: testUserIds[3],
      p_reservation_ids: [],
    })
    expect(error).toBeNull()
    expect(data?.applies).toBe(false)
    expect(data?.reason).toBe('BENEFIT_NOT_ENABLED')
  })

  it('RED: 월 제한 횟수(monthly_limit=1)를 채운 뒤 다른 예약묶음으로 재호출하면 MONTHLY_LIMIT_REACHED로 차단된다', async () => {
    const first = await adminRpcCall('apply_subscription_free_shipping', {
      p_user_id: testUserIds[4],
      p_reservation_ids: [freqReservationId1],
    })
    expect(first.error).toBeNull()
    expect(first.data?.applies).toBe(true)

    // 다른(별개) 예약묶음이므로 idempotency(already_applied)에 걸리지 않고 월 한도 체크로 도달
    const second = await adminRpcCall('apply_subscription_free_shipping', {
      p_user_id: testUserIds[4],
      p_reservation_ids: [freqReservationId2],
    })
    expect(second.error).toBeNull()
    expect(second.data?.applies).toBe(false)
    expect(second.data?.reason).toBe('MONTHLY_LIMIT_REACHED')

    // 실제로 사용기록이 1건만 생겼는지(2건이면 한도 로직이 무력화된 것)
    const { data: usageRows } = await adminClient!
      .from('subscription_benefit_usage')
      .select('id')
      .eq('user_subscription_id', subFrequency)
      .eq('benefit_type', 'FREE_SHIPPING')
    expect((usageRows ?? []).length).toBe(1)
  })
})
