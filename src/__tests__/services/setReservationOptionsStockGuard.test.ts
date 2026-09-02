/**
 * TDD-RED: setReservationOptionsStockGuard.test.ts
 * set_reservation_options RPC 서버측 재고 최종방어선 (Migration 428, 2026-09-03)
 *
 * 배경: 옵션상품(reservation_options)은 메인상품(rental_reservations)과 달리 실물 재고 단위를
 * FOR UPDATE SKIP LOCKED로 원자 배정하지 않고 qty(수량)만 기록한다. 이번 세션에서 만든 프론트
 * 사전차단(stockCapFor/incrementOptionQty 등)은 브라우저 UI 가드일 뿐이라 devtools 직접 RPC
 * 호출이나 필수옵션 기본값(qty=1, 재고와 무관하게 세팅됨) 흐름으로 우회될 수 있었다(QA 지적,
 * 2026-09-03 Stephen 확인 후 승인). 이 RPC 자체에 최종 재고 검증을 추가한다.
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트 — 기존 RPC 통합테스트들과 동일
 * createEphemeralSession 패턴. Migration 428이 Stage에 적용되기 전까지는 재고초과 케이스가
 * 예외 없이 성공하는 것이 RED 상태.
 *
 * ⚠️ 옵션상품 fixture는 공유 상수(FIXTURE_1CHILD_ID 등)를 재사용하지 않고 테스트마다 admin으로
 * 직접 생성한다 — Stage DB를 직접 조회해보니 그 공유 fixture가 과거의 다른 테스트/수동 검증
 * 잔여 데이터(status='confirmed' reservation_options 다수)로 이미 "오염"돼 있어 실제 가용재고가
 * 0으로 계산됨을 확인했다(이번 세션이 만든 오염 아님 — 이전부터 누적된 상태). "가용재고 1개"
 * 라는 전제가 신뢰 불가능해 매 테스트마다 완전히 격리된 신규 옵션상품(부모+자식 1개)을 만들어
 * 교차오염을 원천 차단한다.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// Stage DB 확인된 활성 자식 4개짜리 부모 상품(Canon RF 24-70mm F2.8L) — "carrier" 메인상품으로 사용
const FIXTURE_MAIN_ID = '955238da-5440-47b1-906d-4865232f3a6c'

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

async function createEphemeralSession(): Promise<{ client: SupabaseClient; userId: string }> {
  const email = `tdd-opt-stock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
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

/** 완전히 격리된 신규 옵션상품(부모 + 활성 자식 childCount개)을 생성하고 부모 id를 반환한다. */
async function createIsolatedOptionProduct(childCount: number): Promise<string> {
  const { data: parent, error: parentErr } = await admin
    .from('products')
    .insert({ name: `[TDD] 격리옵션상품 ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, category: 'other', is_active: true })
    .select('id')
    .single()
  if (parentErr || !parent) throw new Error(`fixture 부모상품 생성 실패: ${parentErr?.message}`)
  const parentId = (parent as { id: string }).id
  cleanups.push(async () => {
    await admin.from('products').delete().eq('id', parentId)
  })

  for (let i = 0; i < childCount; i++) {
    const { error: childErr } = await admin
      .from('products')
      .insert({ name: `[TDD] 격리옵션자식 ${i}`, category: 'other', is_active: true, parent_product_id: parentId })
    if (childErr) throw new Error(`fixture 자식상품 생성 실패: ${childErr.message}`)
  }

  return parentId
}

type DraftRow = { success: boolean; reservation_id: number | null; error_message: string | null }

async function createCarrierReservation(client: SupabaseClient): Promise<number> {
  const { data, error } = await client.rpc('create_draft_reservation', { p_product_id: FIXTURE_MAIN_ID })
  if (error) throw new Error(`create_draft_reservation 오류: ${error.message}`)
  const row = (data as DraftRow[] | null)?.[0]
  if (!row?.success || row.reservation_id == null) throw new Error(`create_draft_reservation 실패: ${row?.error_message}`)
  cleanups.push(async () => {
    await admin.from('rental_reservations').delete().eq('id', row.reservation_id)
  })
  return row.reservation_id
}

async function setOptions(
  client: SupabaseClient,
  reservationId: number,
  options: Array<{ option_product_id: string | null; option_name: string; qty: number; unit_price?: number }>,
): Promise<{ error: { message?: string } | null }> {
  const { error } = await client.rpc('set_reservation_options', {
    p_reservation_id: reservationId,
    p_options: options.map(o => ({ ...o, unit_price: o.unit_price ?? 0 })),
  })
  return { error: error as { message?: string } | null }
}

async function markHold(reservationId: number): Promise<void> {
  const { error } = await admin.from('rental_reservations').update({ status: 'hold' }).eq('id', reservationId)
  if (error) throw new Error(`markHold 실패: ${error.message}`)
}

async function markCancelled(reservationId: number): Promise<void> {
  const { error } = await admin.from('rental_reservations').update({ status: 'cancelled' }).eq('id', reservationId)
  if (error) throw new Error(`markCancelled 실패: ${error.message}`)
}

async function readOptions(reservationId: number): Promise<Array<{ option_product_id: string | null; qty: number }>> {
  const { data } = await admin
    .from('reservation_options')
    .select('option_product_id, qty')
    .eq('reservation_id', reservationId)
  return (data ?? []) as Array<{ option_product_id: string | null; qty: number }>
}

describe('[TDD] set_reservation_options — 단일 예약 내 재고 상한 검증', () => {
  it('가용재고(1) 이내 qty=1 저장은 성공한다', async () => {
    const { client } = await createEphemeralSession()
    const optionId = await createIsolatedOptionProduct(1)
    const resId = await createCarrierReservation(client)
    const { error } = await setOptions(client, resId, [
      { option_product_id: optionId, option_name: '테스트 옵션', qty: 1 },
    ])
    expect(error).toBeNull()
    const rows = await readOptions(resId)
    expect(rows).toEqual([{ option_product_id: optionId, qty: 1 }])
  })

  it('가용재고(1)를 초과하는 qty=2 저장은 실패(OPTION_STOCK_EXCEEDED)하고 아무 것도 저장되지 않는다', async () => {
    const { client } = await createEphemeralSession()
    const optionId = await createIsolatedOptionProduct(1)
    const resId = await createCarrierReservation(client)
    const { error } = await setOptions(client, resId, [
      { option_product_id: optionId, option_name: '테스트 옵션', qty: 2 },
    ])
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/OPTION_STOCK_EXCEEDED/)
    const rows = await readOptions(resId)
    expect(rows).toEqual([])
  })

  it('재고 검증 실패 시 기존에 저장돼 있던 옵션도 롤백되어 그대로 유지된다(부분삭제 없음)', async () => {
    const { client } = await createEphemeralSession()
    const optionId = await createIsolatedOptionProduct(1)
    const resId = await createCarrierReservation(client)
    await setOptions(client, resId, [{ option_product_id: optionId, option_name: '테스트 옵션', qty: 1 }])
    // 두 번째 호출: 같은 옵션 qty=2(초과)로 교체 시도 → 실패해야 하고, 기존 qty=1 그대로 유지돼야 함
    const { error } = await setOptions(client, resId, [
      { option_product_id: optionId, option_name: '테스트 옵션', qty: 2 },
    ])
    expect(error).not.toBeNull()
    const rows = await readOptions(resId)
    expect(rows).toEqual([{ option_product_id: optionId, qty: 1 }])
  })
})

describe('[TDD] set_reservation_options — 예약 간 누적 점유(교차예약) 검증', () => {
  it('다른 예약(hold)이 이미 가용재고 전량을 점유 중이면 새 예약의 동일 옵션 저장은 실패한다', async () => {
    const { client } = await createEphemeralSession()
    const optionId = await createIsolatedOptionProduct(1)
    const resA = await createCarrierReservation(client)
    await setOptions(client, resA, [{ option_product_id: optionId, option_name: '테스트 옵션', qty: 1 }])
    await markHold(resA)

    const resB = await createCarrierReservation(client)
    const { error } = await setOptions(client, resB, [
      { option_product_id: optionId, option_name: '테스트 옵션', qty: 1 },
    ])
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/OPTION_STOCK_EXCEEDED/)
  })

  it('점유 중이던 다른 예약이 cancelled로 전환되면 그 재고는 다시 가용 상태로 풀린다', async () => {
    const { client } = await createEphemeralSession()
    const optionId = await createIsolatedOptionProduct(1)
    const resA = await createCarrierReservation(client)
    await setOptions(client, resA, [{ option_product_id: optionId, option_name: '테스트 옵션', qty: 1 }])
    await markHold(resA)
    await markCancelled(resA)

    const resB = await createCarrierReservation(client)
    const { error } = await setOptions(client, resB, [
      { option_product_id: optionId, option_name: '테스트 옵션', qty: 1 },
    ])
    expect(error).toBeNull()
  })

  it('동일 예약을 같은 qty로 재호출(재저장)해도 자기 자신을 이중으로 카운트하지 않아 성공한다', async () => {
    const { client } = await createEphemeralSession()
    const optionId = await createIsolatedOptionProduct(1)
    const resA = await createCarrierReservation(client)
    await setOptions(client, resA, [{ option_product_id: optionId, option_name: '테스트 옵션', qty: 1 }])
    await markHold(resA)

    const { error } = await setOptions(client, resA, [
      { option_product_id: optionId, option_name: '테스트 옵션(재저장)', qty: 1 },
    ])
    expect(error).toBeNull()
    const rows = await readOptions(resA)
    expect(rows).toEqual([{ option_product_id: optionId, qty: 1 }])
  })

  it('draft 상태 예약도 동일하게 검증 대상이다(hold 승격 전이라고 검증을 건너뛰지 않음)', async () => {
    const { client } = await createEphemeralSession()
    const optionId = await createIsolatedOptionProduct(1)
    const resA = await createCarrierReservation(client)
    await setOptions(client, resA, [{ option_product_id: optionId, option_name: '테스트 옵션', qty: 1 }])
    await markHold(resA)

    // resB는 draft 상태 그대로 시도(hold 승격 안 함)
    const resB = await createCarrierReservation(client)
    const { error } = await setOptions(client, resB, [
      { option_product_id: optionId, option_name: '테스트 옵션', qty: 1 },
    ])
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/OPTION_STOCK_EXCEEDED/)
  })
})

describe('[TDD] set_reservation_options — 검증 예외 케이스', () => {
  it('option_product_id가 NULL(실물 미연결 텍스트 옵션)이면 재고 검증을 건너뛰고 큰 qty도 저장된다', async () => {
    const { client } = await createEphemeralSession()
    const resId = await createCarrierReservation(client)
    const { error } = await setOptions(client, resId, [
      { option_product_id: null, option_name: '텍스트 전용 옵션', qty: 9999 },
    ])
    expect(error).toBeNull()
    const rows = await readOptions(resId)
    expect(rows).toEqual([{ option_product_id: null, qty: 9999 }])
  })

  it('활성 자식이 0개(재고 자체가 없는 옵션상품)면 qty=1도 실패한다', async () => {
    const { client } = await createEphemeralSession()
    const emptyOptionId = await createIsolatedOptionProduct(0)
    const resId = await createCarrierReservation(client)
    const { error } = await setOptions(client, resId, [
      { option_product_id: emptyOptionId, option_name: '재고없는 옵션', qty: 1 },
    ])
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/OPTION_STOCK_EXCEEDED/)
  })
})
