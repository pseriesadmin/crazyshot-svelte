/**
 * TDD-RED: getUnavailableDatesForCart.test.ts
 * get_unavailable_dates_for_cart RPC (Migration 426) 라이브 통합테스트
 * (장바구니 대여예약옵션 캘린더 ↔ 실제 날짜별 재고 동기화, 2026-09-02 Stephen 승인 — "요구사항 1")
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트 — 기존 RPC 통합테스트들과 동일
 * createEphemeralSession 패턴. 실제 create_hold_reservation RPC로 재고를 점유시켜
 * 반환되는 unavailable_date 집합이 정확한지 검증한다(H-01 — 직접 INSERT 금지, RPC 경유).
 *
 * Migration 426이 Stage에 적용되기 전까지는 "Could not find the function"으로 실패하는
 * 것이 정상(RED 상태).
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// Stage DB 확인된 활성 자식 4개짜리 부모 상품(Canon RF 24-70mm F2.8L) — 다른 테스트 파일들과 공유
const FIXTURE_4CHILD_ID = '955238da-5440-47b1-906d-4865232f3a6c'
// 활성 자식 1개짜리 부모 상품(SONY PXW-Z90) — "완전 점유" 재현이 간단함
const FIXTURE_1CHILD_ID = '467c8f9b-ca0e-4143-8c27-d04c993a8baa'

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

async function createEphemeralSession(): Promise<{ client: SupabaseClient; userId: string }> {
  const email = `tdd-unavail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
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

// 매 테스트마다 겹치지 않는 랜덤 미래 구간(다른 테스트 파일들과도 충돌 방지)
function randomFutureDay(): string {
  const dayOffset = Math.floor(Math.random() * 3650) + 365
  const d = new Date(Date.UTC(2029, 0, 1) + dayOffset * 86400000)
  return d.toISOString().slice(0, 10)
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

type HoldRow = { success: boolean; reservation_id: number | null; error_message: string | null }

async function createHold(client: SupabaseClient, productId: string, startDate: string, endDate: string): Promise<number> {
  const { data, error } = await client.rpc('create_hold_reservation', {
    p_product_id: productId,
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

async function getUnavailable(
  client: SupabaseClient,
  productIds: string[],
  qtyNeeded: number[],
  rangeStart: string,
  rangeEnd: string,
  fixedStart: string | null = null,
): Promise<string[]> {
  const { data, error } = await client.rpc('get_unavailable_dates_for_cart', {
    p_product_ids: productIds,
    p_qty_needed: qtyNeeded,
    p_range_start: rangeStart,
    p_range_end: rangeEnd,
    p_fixed_start: fixedStart,
  })
  if (error) throw new Error(`get_unavailable_dates_for_cart 오류: ${error.message}`)
  return ((data as Array<{ unavailable_date: string }> | null) ?? []).map(r => r.unavailable_date)
}

describe('[TDD] get_unavailable_dates_for_cart — 기본 동작', () => {
  it('점유된 예약이 없으면 넓은 범위를 조회해도 빈 배열을 반환한다', async () => {
    const { client } = await createEphemeralSession()
    const start = randomFutureDay()
    const end = addDays(start, 10)
    const result = await getUnavailable(client, [FIXTURE_4CHILD_ID], [1], start, end)
    expect(result).toEqual([])
  })

  it('활성 자식 1개짜리 상품을 그 날짜에 1건 점유시키면 해당 날짜만 unavailable로 반환된다', async () => {
    const { client } = await createEphemeralSession()
    const day = randomFutureDay()
    await createHold(client, FIXTURE_1CHILD_ID, day, day)

    const before = addDays(day, -1)
    const after = addDays(day, 1)
    const result = await getUnavailable(client, [FIXTURE_1CHILD_ID], [1], before, after)

    expect(result).toEqual([day])
  })

  it('활성 자식 4개 중 4개를 전부 점유해야 해당 날짜가 unavailable(qty_needed=1)이 된다 — 3개만 점유 시엔 아직 가용', async () => {
    const { client } = await createEphemeralSession()
    const day = randomFutureDay()
    await createHold(client, FIXTURE_4CHILD_ID, day, day)
    await createHold(client, FIXTURE_4CHILD_ID, day, day)
    await createHold(client, FIXTURE_4CHILD_ID, day, day)

    // 3개만 점유 — 아직 1개 남아있어 qty_needed=1이면 가용
    const stillOk = await getUnavailable(client, [FIXTURE_4CHILD_ID], [1], day, day)
    expect(stillOk).toEqual([])

    // qty_needed=2로 요구하면(남은 건 1개뿐) 이미 부족 — unavailable
    const needsTwo = await getUnavailable(client, [FIXTURE_4CHILD_ID], [2], day, day)
    expect(needsTwo).toEqual([day])

    // 마지막 1개까지 점유하면 qty_needed=1도 unavailable
    await createHold(client, FIXTURE_4CHILD_ID, day, day)
    const fullyBooked = await getUnavailable(client, [FIXTURE_4CHILD_ID], [1], day, day)
    expect(fullyBooked).toEqual([day])
  })

  it('qty_needed가 총 재고(활성 자식 수)보다 크면 점유 여부와 무관하게 항상 unavailable', async () => {
    const { client } = await createEphemeralSession()
    const day = randomFutureDay()
    const result = await getUnavailable(client, [FIXTURE_4CHILD_ID], [99], day, day)
    expect(result).toEqual([day])
  })
})

describe('[TDD] get_unavailable_dates_for_cart — 복수 상품(장바구니 여러 개)', () => {
  it('여러 상품 중 하나라도 그 날짜에 재고가 없으면 결과에 포함된다(OR 판정)', async () => {
    const { client } = await createEphemeralSession()
    const day = randomFutureDay()
    // SONY PXW-Z90(자식 1개)을 완전 점유 — Canon(자식 4개)은 그대로 둠
    await createHold(client, FIXTURE_1CHILD_ID, day, day)

    const result = await getUnavailable(
      client,
      [FIXTURE_4CHILD_ID, FIXTURE_1CHILD_ID],
      [1, 1],
      day, day,
    )
    // Canon은 가용하지만 SONY가 불가하므로 그 날짜 전체가 unavailable로 표시돼야 함
    expect(result).toEqual([day])
  })

  it('모든 상품이 가용하면 결과는 빈 배열', async () => {
    const { client } = await createEphemeralSession()
    const day = randomFutureDay()
    const result = await getUnavailable(
      client,
      [FIXTURE_4CHILD_ID, FIXTURE_1CHILD_ID],
      [1, 1],
      day, day,
    )
    expect(result).toEqual([])
  })
})

describe('[TDD] get_unavailable_dates_for_cart — p_fixed_start(반납일 모드, 실제 범위 검증)', () => {
  it('후보 반납일 자체는 비어있어도 [수령일,반납일] 구간 중간에 점유가 있으면 unavailable로 잡힌다', async () => {
    const { client } = await createEphemeralSession()
    const pickup = randomFutureDay()
    const middleDay = addDays(pickup, 2)
    const candidateReturn = addDays(pickup, 4)

    // 중간 날짜 하나만 완전 점유(자식 1개짜리 상품)
    await createHold(client, FIXTURE_1CHILD_ID, middleDay, middleDay)

    // p_fixed_start=pickup으로 반납일 후보 범위를 조회 — candidateReturn 자체와 그 middleDay를
    // 포함하는 모든 반납일 후보가 [pickup, 그 후보일] 구간에 middleDay를 포함하므로 unavailable
    const result = await getUnavailable(
      client,
      [FIXTURE_1CHILD_ID],
      [1],
      middleDay, // 범위 시작을 middleDay부터로 좁혀 검증을 단순화
      candidateReturn,
      pickup,
    )
    // middleDay부터 candidateReturn까지 전부 [pickup, d] 구간이 middleDay를 포함하므로 전부 unavailable
    expect(result.sort()).toEqual([middleDay, addDays(middleDay, 1), addDays(middleDay, 2)].sort())
  })

  it('점유일 이전 반납 후보는(구간이 점유일을 포함하지 않으므로) 영향받지 않는다', async () => {
    const { client } = await createEphemeralSession()
    const pickup = randomFutureDay()
    const occupiedDay = addDays(pickup, 5)
    await createHold(client, FIXTURE_1CHILD_ID, occupiedDay, occupiedDay)

    const result = await getUnavailable(
      client,
      [FIXTURE_1CHILD_ID],
      [1],
      pickup,
      addDays(pickup, 3), // occupiedDay(pickup+5)보다 앞선 후보들만 조회
      pickup,
    )
    expect(result).toEqual([])
  })
})

describe('[TDD] get_unavailable_dates_for_cart — 인증 케이스', () => {
  // Migration 427(2026-09-03) — anon EXECUTE 권한 자체를 명시적으로 REVOKE했으므로, 이제
  // anon 호출은 함수 내부 로직(auth.uid() IS NULL 시 빈 결과)에 도달하기 전에 PostgREST
  // 권한 레벨에서 차단된다(permission denied). 함수 자체가 authenticated 전용임을 검증한다.
  it('로그인 세션 없음(anon) → 함수 실행권한 자체가 없어 permission denied 에러', async () => {
    const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    const day = randomFutureDay()
    const { error } = await anon.rpc('get_unavailable_dates_for_cart', {
      p_product_ids: [FIXTURE_4CHILD_ID],
      p_qty_needed: [1],
      p_range_start: day,
      p_range_end: day,
      p_fixed_start: null,
    })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/permission denied/i)
  })
})
