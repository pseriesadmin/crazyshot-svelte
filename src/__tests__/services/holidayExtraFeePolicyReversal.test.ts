/**
 * TDD: compute_reservation_line_amount — 휴무일 연장요금 정책 전면 개정 검증
 * (Migration 509, 2026-09-19, Stephen 확정)
 *
 * 배경: 2026-09-19 실사용 검증 중 Stephen이 다음 2가지를 명시적으로 지적·확정:
 *   1. "첫날 무료" 예외(migration 501, Stephen 3차 최종 확정)는 "심각한 변경정책
 *      미적용 오류"이며 완전히 폐기한다 — 연장일수 N 전체에 daily×0.5를 부과한다.
 *   2. 옵션상품도 무조건 이 50% 할인 요금이 부과되어야 한다 — 과거엔 옵션에 이 특례가
 *      아예 미적용이라 연장일도 정상가 그대로 청구됐다(실제 캡처 화면 분석으로 발견:
 *      본상품 70,000+옵션 30,000, 수령측 1일 연장(N=1) 상황에서 옵션이 연장된 3일치
 *      정상가로 청구돼 대여요금이 기대보다 30,000원 더 계산됨).
 *
 * 이 테스트는 Migration 508(set_reservation_shipment_method 재계산)이 이미 GREEN인
 * 전제 위에서, compute_reservation_line_amount 자체의 새 요금 공식만 검증한다.
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트 —
 * setReservationShipmentMethodHolidayExtension.test.ts와 동일 ephemeral session 패턴.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// Stage DB 확인된 활성 자식 4개짜리 부모 상품(Canon RF 24-70mm F2.8L) — 다른 테스트 파일들과 공유
// price_rules: 24h=25000 / 12h=20000 (Stage 직접 조회로 확인, 2026-09-19)
const FIXTURE_PARENT_ID = '955238da-5440-47b1-906d-4865232f3a6c'
const MAIN_DAILY = 25000
const COURIER_METHOD = 'crazydelivery'
const NON_COURIER_METHOD = 'visit'

// 12h price_rule이 있는 임의의 다른 상품(Manfrotto 055, 12h=20000) — 옵션의 option_product_id로
// 참조만 함(price_12h가 NOT NULL이기만 하면 되고, delivery_locked 시나리오에서는 v_has_half가
// 항상 false라 실제 12h 금액 자체는 결과에 영향 없음). option_name/unit_price는 이 테스트가
// 직접 지정하므로 이 상품 자체의 24h 가격과는 무관.
const OPTION_PRODUCT_ID = 'b83bc6f4-4824-4ea5-a067-b7ebac9507c5'
const OPTION_UNIT_PRICE = 10000

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

async function createEphemeralSession(): Promise<{ client: SupabaseClient; userId: string }> {
  const email = `tdd-holiday-policy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
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

/** 먼 미래의 "월요일" 수령일 + 다음날(화요일) 반납일(전날=일요일, 결정적 재현용) —
 * 원래 요청 기간이 정확히 "2일"(월,화)이 되도록 +1일만 더함(과거 setReservationShipmentMethod
 * HolidayExtension.test.ts의 +2일 버전을 그대로 복사했다가 "원래 3일 기간"이 되어 이 파일의
 * ×2 기대값과 어긋나는 자체 계산 실수가 있었음 — 이 파일에서는 반드시 +1일로 유지할 것). */
function futureMondayRange(): { start: string; end: string } {
  const base = new Date(Date.UTC(2030, 0, 1))
  const dow = base.getUTCDay()
  const toMonday = (8 - dow) % 7 || 7
  base.setUTCDate(base.getUTCDate() + toMonday + Math.floor(Math.random() * 200) * 7)
  const start = base.toISOString().slice(0, 10)
  const end = new Date(base.getTime() + 1 * 86400000).toISOString().slice(0, 10)
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

async function setShipmentMethod(client: SupabaseClient, reservationId: number, pickupMethod: string, returnMethod: string) {
  const { error } = await client.rpc('set_reservation_shipment_method', {
    p_reservation_id: reservationId,
    p_pickup_method: pickupMethod,
    p_return_method: returnMethod,
    p_pickup_time: '10:00',
    p_return_time: '10:00',
  })
  if (error) throw new Error(`set_reservation_shipment_method 실패: ${error.message}`)
}

async function addOption(reservationId: number, unitPrice: number, qty: number): Promise<number> {
  const { data, error } = await admin
    .from('reservation_options')
    .insert({
      reservation_id: reservationId,
      option_product_id: OPTION_PRODUCT_ID,
      option_name: 'TDD 테스트 옵션',
      qty,
      unit_price: unitPrice,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`reservation_options 생성 실패: ${error?.message}`)
  return data.id as number
}

async function computeLineAmount(reservationId: number) {
  const { data, error } = await admin.rpc('compute_reservation_line_amount', { p_reservation_id: reservationId })
  if (error) throw new Error(`compute_reservation_line_amount 실패: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  return row as { rental_fee: number; options_fee: number; deposit: number; holiday_extra_fee: number }
}

describe('[TDD] compute_reservation_line_amount — 휴무일 연장요금 정책 개정(Migration 509)', () => {
  it('EC-1: N=1(수령측만 연장), 옵션 없음 — 첫날도 무료가 아니라 50% 부과된다', async () => {
    const { client } = await createEphemeralSession()
    const { start, end } = futureMondayRange()
    const reservationId = await createBareHold(client, start, end)
    cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', reservationId) })

    await setShipmentMethod(client, reservationId, COURIER_METHOD, NON_COURIER_METHOD)

    const result = await computeLineAmount(reservationId)
    // N=1 → 과거(폐기됨)엔 0원, 이제는 daily*0.5
    expect(Number(result.holiday_extra_fee)).toBe(MAIN_DAILY * 0.5)
    // rental_fee는 여전히 "원래 요청한 2일" 기준으로 넷팅되어야 함(무변경 로직)
    expect(Number(result.rental_fee)).toBe(MAIN_DAILY * 2)
  })

  it('EC-2: N=1, 옵션 1개(qty=1) 포함 — 옵션도 자기 요율로 50% 부과 + 옵션 기본요금도 원래 일수로 넷팅', async () => {
    const { client } = await createEphemeralSession()
    const { start, end } = futureMondayRange()
    const reservationId = await createBareHold(client, start, end)
    cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', reservationId) })

    await setShipmentMethod(client, reservationId, COURIER_METHOD, NON_COURIER_METHOD)
    const optionId = await addOption(reservationId, OPTION_UNIT_PRICE, 1)
    cleanups.push(async () => { await admin.from('reservation_options').delete().eq('id', optionId) })

    const result = await computeLineAmount(reservationId)

    const expectedMainExtra = MAIN_DAILY * 0.5
    const expectedOptionExtra = OPTION_UNIT_PRICE * 0.5
    expect(Number(result.holiday_extra_fee)).toBe(expectedMainExtra + expectedOptionExtra)
    // 옵션 기본요금(options_fee)도 연장된 3일이 아니라 원래 2일 기준으로 넷팅돼야 함
    expect(Number(result.options_fee)).toBe(OPTION_UNIT_PRICE * 2)
    expect(Number(result.rental_fee)).toBe(MAIN_DAILY * 2)
  })

  it('EC-3: N=1, 옵션 qty=2 — 옵션 연장요금도 qty만큼 배수 적용', async () => {
    const { client } = await createEphemeralSession()
    const { start, end } = futureMondayRange()
    const reservationId = await createBareHold(client, start, end)
    cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', reservationId) })

    await setShipmentMethod(client, reservationId, COURIER_METHOD, NON_COURIER_METHOD)
    const optionId = await addOption(reservationId, OPTION_UNIT_PRICE, 2)
    cleanups.push(async () => { await admin.from('reservation_options').delete().eq('id', optionId) })

    const result = await computeLineAmount(reservationId)

    const expectedMainExtra = MAIN_DAILY * 0.5
    const expectedOptionExtra = OPTION_UNIT_PRICE * 0.5 * 2
    expect(Number(result.holiday_extra_fee)).toBe(expectedMainExtra + expectedOptionExtra)
    expect(Number(result.options_fee)).toBe(OPTION_UNIT_PRICE * 2 * 2)
  })

  it('EC-4: 연장 없음(N=0) — 옵션이 있어도 휴무일연장요금 0원, 옵션요금도 정상 2일치', async () => {
    const { client } = await createEphemeralSession()
    const { start, end } = futureMondayRange()
    const reservationId = await createBareHold(client, start, end)
    cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', reservationId) })

    // 둘 다 non-courier — 연장 자체가 발생하지 않음. non-courier(non-delivery-locked)는
    // "+1일 포함" 산식이 아니라 12시간 블록 산식이 적용되므로, 수령10:00→반납10:00(정확히
    // 24시간)은 1일치로 계산된다(delivery-locked 시나리오의 "월~화 2일" 관례와 다름 — 이
    // 테스트만 그 차이를 명시적으로 검증).
    await setShipmentMethod(client, reservationId, NON_COURIER_METHOD, NON_COURIER_METHOD)
    const optionId = await addOption(reservationId, OPTION_UNIT_PRICE, 1)
    cleanups.push(async () => { await admin.from('reservation_options').delete().eq('id', optionId) })

    const result = await computeLineAmount(reservationId)
    expect(Number(result.holiday_extra_fee)).toBe(0)
    expect(Number(result.options_fee)).toBe(OPTION_UNIT_PRICE * 1)
  })
})
