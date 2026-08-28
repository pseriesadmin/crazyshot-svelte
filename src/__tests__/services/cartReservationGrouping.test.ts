/**
 * TDD-RED: cartReservationGrouping.test.ts
 * find_matching_cart_reservation_group RPC (Migration 371) 라이브 통합테스트
 * (plan: 장바구니 동일 부모상품 중복담기 → 하나로 병합, 2026-08-28 Stephen GATE B 승인)
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트 — accountWithdrawal.test.ts의
 * createEphemeralSession 패턴 재사용(auth.uid()를 쓰는 SECURITY DEFINER RPC 호출 필수).
 * 실제 create_hold_reservation/create_draft_reservation/set_reservation_options RPC를
 * 그대로 호출해 픽스처를 만든다(H-01 — 직접 INSERT 금지, RPC 경유).
 *
 * Migration 371이 Stage에 적용되기 전까지는 "Could not find the function"으로 실패하는
 * 것이 정상(RED 상태).
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// Stage DB 확인된 활성 자식 4개짜리 부모 상품(Canon RF 24-70mm F2.8L) — 동시 hold 2건 여유 충분
const FIXTURE_PARENT_ID = '955238da-5440-47b1-906d-4865232f3a6c'

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

/** ephemeral 사용자 생성 + 로그인 세션 클라이언트 반환 (accountWithdrawal.test.ts 동일 패턴) */
async function createEphemeralSession(): Promise<{ client: SupabaseClient; userId: string }> {
  const email = `tdd-cart-merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
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

// 충돌 방지용 랜덤 미래 날짜 구간(테스트마다 다르게)
function randomFutureRange(): { start: string; end: string } {
  const dayOffset = Math.floor(Math.random() * 3650) + 365
  const start = new Date(Date.UTC(2028, 0, 1) + dayOffset * 86400000)
  const end = new Date(start.getTime() + 2 * 86400000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { start: fmt(start), end: fmt(end) }
}

type HoldRow = { success: boolean; reservation_id: number | null; error_message: string | null }
type DraftRow = { success: boolean; reservation_id: number | null; error_message: string | null }
type GroupRow = { canonical_reservation_id: number; member_reservation_ids: number[]; existing_options: unknown }

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

async function createDraft(client: SupabaseClient): Promise<number> {
  const { data, error } = await client.rpc('create_draft_reservation', { p_product_id: FIXTURE_PARENT_ID })
  if (error) throw new Error(`create_draft_reservation 오류: ${error.message}`)
  const row = (data as DraftRow[] | null)?.[0]
  if (!row?.success || row.reservation_id == null) {
    throw new Error(`create_draft_reservation 실패: ${row?.error_message ?? 'unknown'}`)
  }
  cleanups.push(async () => {
    await admin.from('rental_reservations').delete().eq('id', row.reservation_id)
  })
  return row.reservation_id
}

async function findGroup(
  client: SupabaseClient,
  startDate: string | null,
  endDate: string | null
): Promise<GroupRow | null> {
  const { data, error } = await client.rpc('find_matching_cart_reservation_group', {
    p_product_id: FIXTURE_PARENT_ID,
    p_start_date: startDate,
    p_end_date: endDate,
  })
  if (error) throw new Error(`find_matching_cart_reservation_group 오류: ${error.message}`)
  return (data as GroupRow[] | null)?.[0] ?? null
}

describe('[TDD] find_matching_cart_reservation_group — hold 경로', () => {
  it('같은 부모상품+같은 날짜로 hold 2건 생성 후 조회하면 canonical=최소id, member=오름차순 전체', async () => {
    const { client } = await createEphemeralSession()
    const { start, end } = randomFutureRange()

    const id1 = await createHold(client, start, end)
    const id2 = await createHold(client, start, end)

    const group = await findGroup(client, start, end)

    expect(group).not.toBeNull()
    expect(group?.canonical_reservation_id).toBe(Math.min(id1, id2))
    expect(group?.member_reservation_ids).toEqual([id1, id2].sort((a, b) => a - b))
  })

  it('canonical 예약의 옵션이 existing_options로 반환된다', async () => {
    const { client } = await createEphemeralSession()
    const { start, end } = randomFutureRange()

    const id1 = await createHold(client, start, end)
    await createHold(client, start, end)

    const { error: optErr } = await client.rpc('set_reservation_options', {
      p_reservation_id: id1,
      p_options: [{ option_product_id: null, option_name: '테스트옵션', qty: 2, unit_price: 1000 }],
    })
    if (optErr) throw new Error(`set_reservation_options 오류: ${optErr.message}`)

    const group = await findGroup(client, start, end)

    expect(group?.canonical_reservation_id).toBe(id1)
    expect(group?.existing_options).toEqual([
      { option_product_id: null, option_name: '테스트옵션', qty: 2, unit_price: 1000 },
    ])
  })

  it('날짜가 다르면 매치되지 않는다(Stephen 확정사항 1 — 완전 일치만 병합)', async () => {
    const { client } = await createEphemeralSession()
    const { start, end } = randomFutureRange()
    await createHold(client, start, end)

    const otherRange = randomFutureRange()
    const group = await findGroup(client, otherRange.start, otherRange.end)

    expect(group).toBeNull()
  })

  it('다른 사용자의 예약과는 절대 병합되지 않는다', async () => {
    const { client: clientA } = await createEphemeralSession()
    const { client: clientB } = await createEphemeralSession()
    const { start, end } = randomFutureRange()

    await createHold(clientA, start, end)
    const groupForB = await findGroup(clientB, start, end)

    expect(groupForB).toBeNull()
  })
})

describe('[TDD] find_matching_cart_reservation_group — draft 경로 (날짜 없음)', () => {
  it('같은 부모상품 draft 2건은 날짜 없이도(NULL/NULL 조회) 하나의 그룹으로 매치된다', async () => {
    const { client } = await createEphemeralSession()

    const id1 = await createDraft(client)
    const id2 = await createDraft(client)

    const group = await findGroup(client, null, null)

    expect(group?.canonical_reservation_id).toBe(Math.min(id1, id2))
    expect(group?.member_reservation_ids).toEqual([id1, id2].sort((a, b) => a - b))
  })
})

describe('[TDD] find_matching_cart_reservation_group — 인증/저하 케이스', () => {
  it('로그인 세션 없음(anon) → 빈 결과(에러 아님, 호출측이 "그룹 없음"으로 처리)', async () => {
    const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    const group = await findGroup(anon, '2028-01-01', '2028-01-03')
    expect(group).toBeNull()
  })

  it('자식 상품(재고단위)이 soft-delete되면 그 예약은 매치 대상에서 제외된다(INNER JOIN 저하)', async () => {
    const { client } = await createEphemeralSession()
    const { start, end } = randomFutureRange()

    const id1 = await createHold(client, start, end)

    const { data: rsv } = await admin.from('rental_reservations').select('product_id').eq('id', id1).single()
    const childId = (rsv as { product_id: string }).product_id

    const { error: delErr } = await admin
      .from('products')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', childId)
    if (delErr) throw new Error(`자식상품 soft-delete 실패: ${delErr.message}`)
    cleanups.push(async () => {
      await admin.from('products').update({ deleted_at: null }).eq('id', childId)
    })

    const group = await findGroup(client, start, end)
    expect(group).toBeNull()
  })
})
