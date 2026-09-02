/**
 * TDD-RED: getAvailableStockCounts.test.ts
 * get_available_stock_counts RPC (Migration 421) 라이브 통합테스트
 * (상품상세·장바구니 수량 UI ↔ 실제 재고 동기화, 2026-09-02 Stephen GATE B 승인)
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트 — cartReservationGrouping.test.ts와 동일
 * createEphemeralSession 패턴 재사용. 실제 create_hold_reservation RPC로 재고를 점유시켜
 * available_count가 정확히 감소/복원되는지 검증한다(H-01 — 직접 INSERT 금지, RPC 경유).
 *
 * Migration 421이 Stage에 적용되기 전까지는 "Could not find the function"으로 실패하는
 * 것이 정상(RED 상태).
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// Stage DB 확인된 활성 자식 4개짜리 부모 상품(Canon RF 24-70mm F2.8L) — cartReservationGrouping.test.ts와 공유
const FIXTURE_PARENT_ID = '955238da-5440-47b1-906d-4865232f3a6c'
const NONEXISTENT_PARENT_ID = '00000000-0000-0000-0000-000000000000'

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

async function createEphemeralSession(): Promise<{ client: SupabaseClient; userId: string }> {
  const email = `tdd-stock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
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

type HoldRow = { success: boolean; reservation_id: number | null; error_message: string | null }
type StockRow = { product_id: string; available_count: number }

async function createHold(client: SupabaseClient, startDate: string, endDate: string): Promise<number> {
  const { data, error } = await client.rpc('create_hold_reservation', {
    p_product_id: FIXTURE_PARENT_ID,
    p_start_date: startDate,
    p_end_date: endDate,
  })
  if (error) throw new Error(`create_hold_reservation 오류: ${error.message}`)
  const row = (data as HoldRow[] | null)?.[0]
  if (!row?.success || row.reservation_id == null) {
    throw new Error(`create_hold_reservation 실패: ${row?.error_message ?? 'unknown'}`)
  }
  cleanups.push(async () => {
    await admin.from('rental_reservations').delete().eq('id', row.reservation_id)
  })
  return row.reservation_id
}

async function getStock(client: SupabaseClient, productIds: string[]): Promise<Record<string, number>> {
  const { data, error } = await client.rpc('get_available_stock_counts', { p_product_ids: productIds })
  if (error) throw new Error(`get_available_stock_counts 오류: ${error.message}`)
  const rows = (data as StockRow[] | null) ?? []
  const map: Record<string, number> = {}
  for (const r of rows) map[r.product_id] = r.available_count
  return map
}

describe('[TDD] get_available_stock_counts — 기본 계산', () => {
  it('점유된 예약이 없으면 available_count == 활성 자식 총 개수', async () => {
    const { data: children, error } = await admin
      .from('products')
      .select('id')
      .eq('parent_product_id', FIXTURE_PARENT_ID)
      .eq('is_active', true)
      .is('deleted_at', null)
    if (error) throw new Error(`fixture 자식 조회 실패: ${error.message}`)
    const totalActive = (children ?? []).length
    expect(totalActive).toBeGreaterThan(0)

    const { client } = await createEphemeralSession()
    const stock = await getStock(client, [FIXTURE_PARENT_ID])
    expect(stock[FIXTURE_PARENT_ID]).toBe(totalActive)
  })

  it('hold 예약 1건 생성 시 available_count가 정확히 1 감소한다', async () => {
    const { client } = await createEphemeralSession()
    const before = (await getStock(client, [FIXTURE_PARENT_ID]))[FIXTURE_PARENT_ID]
    const { start, end } = randomFutureRange()

    await createHold(client, start, end)

    const after = (await getStock(client, [FIXTURE_PARENT_ID]))[FIXTURE_PARENT_ID]
    expect(after).toBe(before - 1)
  })

  it('예약이 cancelled로 전환되면 다시 재고로 복귀한다(종결 상태는 점유 아님)', async () => {
    const { client } = await createEphemeralSession()
    const before = (await getStock(client, [FIXTURE_PARENT_ID]))[FIXTURE_PARENT_ID]
    const { start, end } = randomFutureRange()
    const id = await createHold(client, start, end)

    const afterHold = (await getStock(client, [FIXTURE_PARENT_ID]))[FIXTURE_PARENT_ID]
    expect(afterHold).toBe(before - 1)

    const { error: cancelErr } = await admin
      .from('rental_reservations')
      .update({ status: 'cancelled' })
      .eq('id', id)
    if (cancelErr) throw new Error(`상태 전환 실패: ${cancelErr.message}`)

    const afterCancel = (await getStock(client, [FIXTURE_PARENT_ID]))[FIXTURE_PARENT_ID]
    expect(afterCancel).toBe(before)
  })

  it('confirmed/shipped/in_use/return_requested 등 비종결 상태도 재고를 점유한다', async () => {
    const { client } = await createEphemeralSession()
    const before = (await getStock(client, [FIXTURE_PARENT_ID]))[FIXTURE_PARENT_ID]
    const { start, end } = randomFutureRange()
    const id = await createHold(client, start, end)

    const { error: updErr } = await admin
      .from('rental_reservations')
      .update({ status: 'in_use' })
      .eq('id', id)
    if (updErr) throw new Error(`상태 전환 실패: ${updErr.message}`)

    const afterInUse = (await getStock(client, [FIXTURE_PARENT_ID]))[FIXTURE_PARENT_ID]
    expect(afterInUse).toBe(before - 1)
  })
})

describe('[TDD] get_available_stock_counts — 배치·경계 케이스', () => {
  it('여러 product_id를 한 번에 조회해도 각각 독립적으로 정확하다(N+1 방지 배치 조회)', async () => {
    const { client } = await createEphemeralSession()
    const stock = await getStock(client, [FIXTURE_PARENT_ID, NONEXISTENT_PARENT_ID])
    expect(stock[FIXTURE_PARENT_ID]).toBeGreaterThanOrEqual(0)
    expect(stock[NONEXISTENT_PARENT_ID]).toBe(0)
  })

  it('존재하지 않는 부모상품 id는 available_count 0을 반환한다(에러 아님)', async () => {
    const { client } = await createEphemeralSession()
    const stock = await getStock(client, [NONEXISTENT_PARENT_ID])
    expect(stock[NONEXISTENT_PARENT_ID]).toBe(0)
  })

  it('로그인 없이(anon)도 조회 가능하다 — 공개 상품상세 페이지가 비회원에게도 노출되므로', async () => {
    const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    const stock = await getStock(anon, [FIXTURE_PARENT_ID])
    expect(stock[FIXTURE_PARENT_ID]).toBeGreaterThanOrEqual(0)
  })
})
