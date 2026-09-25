/**
 * TDD-RED: bundleInventoryHold.test.ts
 * 결합상품 Phase 2 — 재고 연동 (Migration 547, 2026-09-24 Stephen GATE B 확정 A안 실물 단위 배정)
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트. 모든 fixture(부모·자식·사용자·예약)는 이 파일이
 * 직접 생성하고 afterEach에서 정리한다(기존 Stage 데이터는 읽지도 삭제하지도 않음).
 *
 * 정책 요약(B-START):
 *  - 정상: 패키지 hold 생성/draft→hold 승격 시 같은 트랜잭션에서 결합상품마다 활성 자식 1개를 메인과
 *    동일 기준(날짜 겹침 + FOR UPDATE SKIP LOCKED)으로 배정한다.
 *  - 막을 것: 결합상품 1종이라도 재고 없으면 전체 실패(메인 실물도 점유 안 됨) / 결합상품 단독 예약과
 *    같은 실물 이중예약 / draft가 재고를 점유하는 것.
 *  - 실패 시: '구성품 재고가 부족해 예약할 수 없습니다.' 메시지, 남는 예약·배정 기록 없음.
 *  - 종결 상태(cancelled/expired/returned/completed)는 예약 status 조인으로 자동 해제.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const SHORT_MSG = '구성품 재고가 부족해 예약할 수 없습니다.'

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []

// 동시성 보강 테스트(EC-7)는 fixture가 수십 개라 정리에 10초(기본 훅 제한)를 넘는다 — 정리가 중간에
// 잘려 다음 테스트 데이터를 지우는 교란을 막기 위해 훅 제한을 넉넉히 둔다.
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
}, 180000)

async function createEphemeralSession(): Promise<{ client: SupabaseClient; userId: string }> {
  const email = `tdd-bundle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const password = 'Test1234!'
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`)
  const userId = data.user.id
  const asUser = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
  const { error: signInErr } = await asUser.auth.signInWithPassword({ email, password })
  if (signInErr) throw new Error(`ephemeral user 로그인 실패: ${signInErr.message}`)
  cleanups.push(async () => {
    await admin.from('rental_reservations').delete().eq('user_id', userId)
    await admin.auth.admin.deleteUser(userId)
  })
  return { client: asUser, userId }
}

function randomFutureRange(): { start: string; end: string } {
  const dayOffset = Math.floor(Math.random() * 3000) + 365
  const start = new Date(Date.UTC(2029, 0, 1) + dayOffset * 86400000)
  const end = new Date(start.getTime() + 2 * 86400000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { start: fmt(start), end: fmt(end) }
}

/** 부모 1 + 활성 자식 childCount개. 부모 id와 자식 id 배열 반환. */
async function createProduct(label: string, childCount: number): Promise<{ parentId: string; childIds: string[] }> {
  const { data: parent, error } = await admin
    .from('products')
    .insert({ name: `[TDD-BUNDLE] ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, category: 'other', is_active: true })
    .select('id')
    .single()
  if (error || !parent) throw new Error(`부모상품 생성 실패: ${error?.message}`)
  const parentId = (parent as { id: string }).id
  cleanups.push(async () => {
    await admin.from('product_bundle_links').delete().or(`product_id.eq.${parentId},bundle_product_id.eq.${parentId}`)
    await admin.from('products').delete().eq('parent_product_id', parentId)
    await admin.from('products').delete().eq('id', parentId)
  })
  const childIds: string[] = []
  for (let i = 0; i < childCount; i++) {
    const { data: child, error: cErr } = await admin
      .from('products')
      .insert({ name: `[TDD-BUNDLE] ${label} 자식${i}`, category: 'other', is_active: true, parent_product_id: parentId })
      .select('id')
      .single()
    if (cErr || !child) throw new Error(`자식상품 생성 실패: ${cErr?.message}`)
    childIds.push((child as { id: string }).id)
  }
  return { parentId, childIds }
}

async function linkBundles(packageId: string, bundleIds: string[]): Promise<void> {
  const { error } = await admin.rpc('upsert_product_bundle_links', {
    p_product_id: packageId,
    p_bundle_links: bundleIds.map((id, i) => ({ bundle_product_id: id, display_order: i })),
  })
  if (error) throw new Error(`upsert_product_bundle_links 실패: ${error.message}`)
}

type HoldRow = { success: boolean; reservation_id: number | null; error_message: string | null }

async function hold(client: SupabaseClient, productId: string, start: string, end: string): Promise<HoldRow> {
  const { data, error } = await client.rpc('create_hold_reservation', {
    p_product_id: productId,
    p_start_date: start,
    p_end_date: end,
  })
  if (error) throw new Error(`create_hold_reservation 오류: ${error.message}`)
  const row = (data as HoldRow[] | null)?.[0]
  if (!row) throw new Error('create_hold_reservation 응답 없음')
  return row
}

async function assets(reservationId: number): Promise<string[]> {
  const { data, error } = await admin
    .from('reservation_bundle_assets')
    .select('asset_product_id')
    .eq('reservation_id', reservationId)
  if (error) throw new Error(`reservation_bundle_assets 조회 실패: ${error.message}`)
  return ((data ?? []) as Array<{ asset_product_id: string }>).map(r => r.asset_product_id)
}

async function setStatus(reservationId: number, status: string): Promise<void> {
  const { error } = await admin.from('rental_reservations').update({ status }).eq('id', reservationId)
  if (error) throw new Error(`상태 전환 실패: ${error.message}`)
}

async function stock(client: SupabaseClient, ids: string[]): Promise<Record<string, number>> {
  const { data, error } = await client.rpc('get_available_stock_counts', { p_product_ids: ids })
  if (error) throw new Error(`get_available_stock_counts 오류: ${error.message}`)
  const map: Record<string, number> = {}
  for (const r of (data as Array<{ product_id: string; available_count: number }>) ?? []) map[r.product_id] = r.available_count
  return map
}

async function reservationCount(userId: string): Promise<number> {
  const { count } = await admin.from('rental_reservations').select('id', { count: 'exact', head: true }).eq('user_id', userId)
  return count ?? 0
}

describe('[TDD] EC-1 패키지 hold — 결합상품 실물 배정', () => {
  it('결합상품 2종 각각의 활성 자식 1개가 배정되고 요청 기간 예약이 생성된다', async () => {
    const { client } = await createEphemeralSession()
    const pkg = await createProduct('패키지', 1)
    const b1 = await createProduct('결합1', 1)
    const b2 = await createProduct('결합2', 2)
    await linkBundles(pkg.parentId, [b1.parentId, b2.parentId])
    const { start, end } = randomFutureRange()

    const res = await hold(client, pkg.parentId, start, end)
    expect(res.success).toBe(true)
    const got = await assets(res.reservation_id as number)
    expect(got).toHaveLength(2)
    expect(b1.childIds).toContain(got.find(a => b1.childIds.includes(a)))
    expect(got.filter(a => b2.childIds.includes(a))).toHaveLength(1)
  })

  it('결합상품이 없는 일반 상품은 배정 기록이 생기지 않는다(무회귀)', async () => {
    const { client } = await createEphemeralSession()
    const plain = await createProduct('일반', 1)
    const { start, end } = randomFutureRange()
    const res = await hold(client, plain.parentId, start, end)
    expect(res.success).toBe(true)
    expect(await assets(res.reservation_id as number)).toHaveLength(0)
  })

  it('삭제된 결합상품은 배정 대상에서 제외되고 나머지로 예약이 성공한다(EC-C)', async () => {
    const { client } = await createEphemeralSession()
    const pkg = await createProduct('패키지', 1)
    const live = await createProduct('살아있는결합', 1)
    const dead = await createProduct('삭제된결합', 1)
    await linkBundles(pkg.parentId, [live.parentId, dead.parentId])
    await admin.from('products').update({ deleted_at: new Date().toISOString() }).eq('id', dead.parentId)
    const { start, end } = randomFutureRange()

    const res = await hold(client, pkg.parentId, start, end)
    expect(res.success).toBe(true)
    const got = await assets(res.reservation_id as number)
    expect(got).toHaveLength(1)
    expect(live.childIds).toContain(got[0])
  })
})

describe('[TDD] EC-2 결합상품 재고 부족 — 전체 실패·롤백', () => {
  it('결합상품 1종이 재고 0이면 실패하고 메인 실물·다른 결합 실물도 점유되지 않는다', async () => {
    const { client, userId } = await createEphemeralSession()
    const pkg = await createProduct('패키지', 1)
    const ok = await createProduct('재고있음', 1)
    const empty = await createProduct('재고없음', 0)
    await linkBundles(pkg.parentId, [ok.parentId, empty.parentId])
    const { start, end } = randomFutureRange()

    const res = await hold(client, pkg.parentId, start, end)
    expect(res.success).toBe(false)
    expect(res.error_message).toBe(SHORT_MSG)
    expect(await reservationCount(userId)).toBe(0)
    const { count } = await admin
      .from('reservation_bundle_assets')
      .select('id', { count: 'exact', head: true })
      .in('asset_product_id', ok.childIds)
    expect(count).toBe(0)

    // 메인 실물이 점유되지 않았으므로 결합상품 없는 동일 기간 재시도(구성 제거 후)가 성공한다.
    await linkBundles(pkg.parentId, [ok.parentId])
    const retry = await hold(client, pkg.parentId, start, end)
    expect(retry.success).toBe(true)
  })
})

describe('[TDD] EC-3/EC-4 결합상품 단독 예약과 상호 차단', () => {
  it('패키지가 점유한 기간에 결합상품 단독 예약: 다른 실물이 있으면 그것을 배정, 없으면 실패', async () => {
    const { client } = await createEphemeralSession()
    const pkg = await createProduct('패키지', 1)
    const b = await createProduct('결합', 2)
    await linkBundles(pkg.parentId, [b.parentId])
    const { start, end } = randomFutureRange()

    const pk = await hold(client, pkg.parentId, start, end)
    expect(pk.success).toBe(true)
    const bundleAsset = (await assets(pk.reservation_id as number))[0]

    const solo1 = await hold(client, b.parentId, start, end)
    expect(solo1.success).toBe(true)
    const { data } = await admin.from('rental_reservations').select('product_id').eq('id', solo1.reservation_id).single()
    expect((data as { product_id: string }).product_id).not.toBe(bundleAsset)

    const solo2 = await hold(client, b.parentId, start, end)
    expect(solo2.success).toBe(false)
  })

  it('결합상품 단독 예약이 먼저 점유한 실물뿐이면 패키지 예약이 실패한다', async () => {
    const { client, userId } = await createEphemeralSession()
    const pkg = await createProduct('패키지', 1)
    const b = await createProduct('결합', 1)
    await linkBundles(pkg.parentId, [b.parentId])
    const { start, end } = randomFutureRange()

    const solo = await hold(client, b.parentId, start, end)
    expect(solo.success).toBe(true)
    const before = await reservationCount(userId)

    const pk = await hold(client, pkg.parentId, start, end)
    expect(pk.success).toBe(false)
    expect(pk.error_message).toBe(SHORT_MSG)
    expect(await reservationCount(userId)).toBe(before)
  })

  it('기간이 겹치지 않으면 결합상품 단독 예약이 정상 성공한다(EC-4)', async () => {
    const { client } = await createEphemeralSession()
    const pkg = await createProduct('패키지', 1)
    const b = await createProduct('결합', 1)
    await linkBundles(pkg.parentId, [b.parentId])
    const a = randomFutureRange()
    const far = new Date(new Date(a.start).getTime() + 30 * 86400000)
    const farEnd = new Date(far.getTime() + 2 * 86400000)
    const fmt = (d: Date) => d.toISOString().slice(0, 10)

    expect((await hold(client, pkg.parentId, a.start, a.end)).success).toBe(true)
    expect((await hold(client, b.parentId, fmt(far), fmt(farEnd))).success).toBe(true)
  })
})

describe('[TDD] EC-5 종결 상태 자동 해제', () => {
  it.each(['cancelled', 'expired', 'returned', 'completed'])('패키지 예약이 %s가 되면 결합 실물이 즉시 가용으로 돌아온다', async (terminal) => {
    const { client } = await createEphemeralSession()
    const pkg = await createProduct('패키지', 1)
    const b = await createProduct('결합', 1)
    await linkBundles(pkg.parentId, [b.parentId])
    const { start, end } = randomFutureRange()

    const pk = await hold(client, pkg.parentId, start, end)
    expect(pk.success).toBe(true)
    expect((await hold(client, b.parentId, start, end)).success).toBe(false)
    expect((await stock(client, [b.parentId]))[b.parentId]).toBe(0)

    await setStatus(pk.reservation_id as number, terminal)
    expect((await stock(client, [b.parentId]))[b.parentId]).toBe(1)
    expect((await hold(client, b.parentId, start, end)).success).toBe(true)
  })
})

describe('[TDD] EC-6 draft → hold 승격 경로', () => {
  type DraftRow = { success: boolean; reservation_id: number | null; error_message: string | null }
  async function draft(client: SupabaseClient, productId: string): Promise<number> {
    const { data, error } = await client.rpc('create_draft_reservation', { p_product_id: productId })
    if (error) throw new Error(`create_draft_reservation 오류: ${error.message}`)
    const row = (data as DraftRow[] | null)?.[0]
    if (!row?.success || row.reservation_id == null) throw new Error(`draft 실패: ${row?.error_message}`)
    return row.reservation_id
  }
  async function promote(client: SupabaseClient, id: number, start: string, end: string): Promise<DraftRow> {
    const { data, error } = await client.rpc('promote_draft_reservation', {
      p_reservation_id: id, p_start_date: start, p_end_date: end,
    })
    if (error) throw new Error(`promote_draft_reservation 오류: ${error.message}`)
    return (data as DraftRow[])[0]
  }

  it('draft는 결합 재고를 점유하지 않고, 승격 시 결합 실물이 배정된다', async () => {
    const { client } = await createEphemeralSession()
    const pkg = await createProduct('패키지', 1)
    const b = await createProduct('결합', 1)
    await linkBundles(pkg.parentId, [b.parentId])
    const { start, end } = randomFutureRange()

    const id = await draft(client, pkg.parentId)
    expect(await assets(id)).toHaveLength(0)
    expect((await stock(client, [b.parentId]))[b.parentId]).toBe(1)

    const res = await promote(client, id, start, end)
    expect(res.success).toBe(true)
    const got = await assets(id)
    expect(got).toHaveLength(1)
    expect(b.childIds).toContain(got[0])
  })

  it('승격 시 결합상품 재고가 없으면 실패하고 draft 상태·무배정이 유지된다', async () => {
    const { client } = await createEphemeralSession()
    const pkg = await createProduct('패키지', 1)
    const b = await createProduct('결합', 0)
    await linkBundles(pkg.parentId, [b.parentId])
    const { start, end } = randomFutureRange()

    const id = await draft(client, pkg.parentId)
    const res = await promote(client, id, start, end)
    expect(res.success).toBe(false)
    expect(res.error_message).toBe(SHORT_MSG)
    const { data } = await admin.from('rental_reservations').select('status').eq('id', id).single()
    expect((data as { status: string }).status).toBe('draft')
    expect(await assets(id)).toHaveLength(0)
  })
})

describe('[TDD] EC-7 동시 요청 경합', () => {
  it('마지막 결합 실물 1개를 두 패키지가 동시에 요청하면 1건만 성공한다', async () => {
    const u1 = await createEphemeralSession()
    const u2 = await createEphemeralSession()
    const p1 = await createProduct('패키지A', 1)
    const p2 = await createProduct('패키지B', 1)
    const b = await createProduct('공유결합', 1)
    await linkBundles(p1.parentId, [b.parentId])
    await linkBundles(p2.parentId, [b.parentId])
    const { start, end } = randomFutureRange()

    const [r1, r2] = await Promise.all([
      hold(u1.client, p1.parentId, start, end),
      hold(u2.client, p2.parentId, start, end),
    ])
    expect([r1.success, r2.success].filter(Boolean)).toHaveLength(1)
    const { count } = await admin
      .from('reservation_bundle_assets')
      .select('id', { count: 'exact', head: true })
      .in('asset_product_id', b.childIds)
    expect(count).toBe(1)
  })
})

// ── EC-7 보강(2026-09-24, sp3-qa-agent MEDIUM): 위 2건 경합은 Promise.all이 실제로 겹치지 않고 순차
// 실행돼도 "1건만 성공"이 통과할 수 있어 SKIP LOCKED+재검사 속성을 증명하지 못한다. 아래는
// (1) 요청 수를 늘려 (2) 호출 구간이 실제로 겹쳤는지 시간으로 검증하고 (3) 재고 K개에 N>K건을 던져
// "정확히 K건 성공·배정 실물 중복 0·실패 건 잔여 흔적 0"을 단정한다(라운드 반복으로 타이밍 편차 흡수).
describe('[TDD] EC-7 보강 — 다중 동시 요청 경합 검증력', () => {
  type Timed = HoldRow & { t0: number; t1: number }

  async function timedHold(client: SupabaseClient, productId: string, start: string, end: string, gate: Promise<void>): Promise<Timed> {
    await gate
    const t0 = performance.now()
    const row = await hold(client, productId, start, end)
    return { ...row, t0, t1: performance.now() }
  }

  /** 모든 호출 구간이 한 시점에 공통으로 겹치는지(= 진짜 동시 실행) — 가장 늦은 시작 < 가장 이른 종료 */
  function overlapped(rows: Timed[]): boolean {
    return Math.max(...rows.map(r => r.t0)) < Math.min(...rows.map(r => r.t1))
  }

  // 로그인 N건을 동시에 하면 Supabase Auth 호출 제한(rate limit)에 걸려 테스트가 무의미해진다 —
  // 세션 1개로 서로 다른 DB 연결에서 동시 RPC N건을 던진다(같은 사용자의 다중 hold는 RPC상 허용).
  async function sessions(n: number) {
    const one = await createEphemeralSession()
    return Array.from({ length: n }, () => one)
  }

  /** 서로 다른 패키지 n개(각자 메인 재고 1개)가 같은 결합상품을 공유 — 메인 배정 경합을 배제하고 결합 경합만 남긴다 */
  async function makePackages(n: number, label: string, bundleId: string) {
    const pkgs = await Promise.all(Array.from({ length: n }, (_, i) => createProduct(`${label}${i}`, 1)))
    await Promise.all(pkgs.map(pk => linkBundles(pk.parentId, [bundleId])))
    return pkgs
  }

  async function race(users: Array<{ client: SupabaseClient }>, targets: string[], start: string, end: string): Promise<Timed[]> {
    let open!: () => void
    const gate = new Promise<void>(res => { open = res })
    const pending = targets.map((t, i) => timedHold(users[i % users.length].client, t, start, end, gate))
    await new Promise(r => setTimeout(r, 50))
    open()
    return Promise.all(pending)
  }

  it('결합 실물 1개에 서로 다른 패키지 20건이 동시에 몰려도 정확히 1건만 성공하고 나머지는 부족 메시지로 실패한다(3라운드)', { timeout: 180000 }, async () => {
    const N = 20
    const users = await sessions(1)
    for (let round = 0; round < 3; round++) {
      const b = await createProduct(`결합R${round}`, 1)
      const pkgs = await makePackages(N, `패키지R${round}_`, b.parentId)
      const { start, end } = randomFutureRange()

      const rows = await race(users, pkgs.map(pk => pk.parentId), start, end)

      const ok = rows.filter(r => r.success)
      const fail = rows.filter(r => !r.success)
      expect(overlapped(rows), '호출 구간이 실제로 겹쳐야 동시성 검증이 유효').toBe(true)
      expect(ok).toHaveLength(1)
      expect(fail).toHaveLength(N - 1)
      for (const f of fail) expect(f.error_message).toBe(SHORT_MSG)

      const { count } = await admin.from('reservation_bundle_assets').select('id', { count: 'exact', head: true }).in('asset_product_id', b.childIds)
      expect(count).toBe(1)
      // 실패 건은 메인 예약 흔적도 남기지 않는다(전체 롤백) — 누적 성공 건수만 존재
      expect(await reservationCount(users[0].userId)).toBe(round + 1)
      for (const r of ok) if (r.reservation_id) await setStatus(r.reservation_id, 'cancelled')
    }
  })

  it('결합 실물 3개에 서로 다른 패키지 20건 → 정확히 3건 성공, 배정된 실물 3개는 서로 다르다', { timeout: 180000 }, async () => {
    const N = 20
    const K = 3
    const users = await sessions(1)
    const b = await createProduct('결합K', K)
    const pkgs = await makePackages(N, '패키지K_', b.parentId)
    const { start, end } = randomFutureRange()

    const rows = await race(users, pkgs.map(pk => pk.parentId), start, end)

    expect(overlapped(rows)).toBe(true)
    const ok = rows.filter(r => r.success)
    expect(ok).toHaveLength(K)
    for (const f of rows.filter(r => !r.success)) expect(f.error_message).toBe(SHORT_MSG)

    const assigned = (await Promise.all(ok.map(r => assets(r.reservation_id as number)))).flat()
    expect(assigned).toHaveLength(K)
    expect(new Set(assigned).size).toBe(K) // 같은 실물이 두 예약에 이중 배정되지 않음
    expect(assigned.every(id => b.childIds.includes(id))).toBe(true)
  })

  // 승격 경로가 결합 잠금의 실질적 방어선이다: create_hold_reservation은 예약코드 채번(카운터 행 upsert)이
  // 트랜잭션 끝까지 행 잠금을 잡아 INSERT 단계에서 이미 직렬화되지만, promote_draft_reservation은 기존
  // draft를 UPDATE할 뿐이라 그 직렬화가 없다 — 그래서 위 hold 경합만으로는 SKIP LOCKED+재검사 누락을
  // 잡지 못한다(잠금 없는 변형+0.3초 창 확대에서도 통과함을 확인). 이 테스트가 그 공백을 메운다.
  it('결합 실물 1개에 서로 다른 패키지의 초안 승격 20건이 동시에 몰려도 정확히 1건만 성공한다(승격 경로, 2라운드)', { timeout: 180000 }, async () => {
    const N = 20
    const users = await sessions(1)
    const client = users[0].client
    for (let round = 0; round < 2; round++) {
      const b = await createProduct(`결합PR${round}`, 1)
      const pkgs = await makePackages(N, `패키지PR${round}_`, b.parentId)
      const drafts = await Promise.all(pkgs.map(async pk => {
        const { data, error } = await client.rpc('create_draft_reservation', { p_product_id: pk.parentId })
        if (error) throw new Error(`create_draft_reservation 오류: ${error.message}`)
        const row = (data as Array<{ success: boolean; reservation_id: number | null }>)[0]
        if (!row?.success || row.reservation_id == null) throw new Error('draft 생성 실패')
        return row.reservation_id
      }))
      const { start, end } = randomFutureRange()

      let open!: () => void
      const gate = new Promise<void>(res => { open = res })
      const pending = drafts.map(async id => {
        await gate
        const t0 = performance.now()
        const { data, error } = await client.rpc('promote_draft_reservation', { p_reservation_id: id, p_start_date: start, p_end_date: end })
        if (error) throw new Error(`promote_draft_reservation 오류: ${error.message}`)
        const row = (data as Array<{ success: boolean; reservation_id: number | null; error_message: string | null }>)[0]
        return { success: row.success, reservation_id: row.reservation_id, error_message: row.error_message, t0, t1: performance.now() } as Timed
      })
      await new Promise(r => setTimeout(r, 50))
      open()
      const rows = await Promise.all(pending)

      expect(overlapped(rows)).toBe(true)
      expect(rows.filter(r => r.success)).toHaveLength(1)
      for (const f of rows.filter(r => !r.success)) expect(f.error_message).toBe(SHORT_MSG)
      const { count } = await admin.from('reservation_bundle_assets').select('id', { count: 'exact', head: true }).in('asset_product_id', b.childIds)
      expect(count).toBe(1)
      // 실패한 승격은 draft로 남는다(전체 롤백)
      const { data: stillDraft } = await admin.from('rental_reservations').select('id').in('id', drafts).eq('status', 'draft')
      expect((stillDraft ?? []).length).toBe(N - 1)
      for (const id of drafts) await setStatus(id, 'cancelled')
    }
  })

  it('결합 실물 1개를 패키지 예약과 결합상품 단독 예약이 동시에 요청하면 한쪽만 성공한다(양방향 상호 차단, 3라운드)', { timeout: 120000 }, async () => {
    const users = await sessions(4)
    for (let round = 0; round < 3; round++) {
      const pkg = await createProduct(`패키지M${round}`, 2)
      const b = await createProduct(`결합M${round}`, 1)
      await linkBundles(pkg.parentId, [b.parentId])
      const { start, end } = randomFutureRange()

      let open!: () => void
      const gate = new Promise<void>(res => { open = res })
      // 패키지 2건 + 결합상품 단독 2건이 같은 실물 1개를 두고 경합
      const pending = [
        timedHold(users[0].client, pkg.parentId, start, end, gate),
        timedHold(users[1].client, pkg.parentId, start, end, gate),
        timedHold(users[2].client, b.parentId, start, end, gate),
        timedHold(users[3].client, b.parentId, start, end, gate),
      ]
      await new Promise(r => setTimeout(r, 50))
      open()
      const rows = await Promise.all(pending)

      expect(overlapped(rows)).toBe(true)
      expect(rows.filter(r => r.success)).toHaveLength(1) // 실물은 1개뿐 — 패키지든 단독이든 한 건만
      // 단독이 성공했다면 그 실물이 결합 배정에 쓰이지 않았고, 패키지가 성공했다면 배정 기록이 정확히 1건
      const { count } = await admin.from('reservation_bundle_assets').select('id', { count: 'exact', head: true }).in('asset_product_id', b.childIds)
      const winner = rows.findIndex(r => r.success)
      expect(count).toBe(winner <= 1 ? 1 : 0)
      for (const r of rows) if (r.success && r.reservation_id) await setStatus(r.reservation_id, 'cancelled')
    }
  })
})

describe('[TDD] 가용재고 표시 — 결합 점유 반영 + 패키지 = min(자신, 각 결합상품)', () => {
  it('패키지 가용은 결합상품 가용 이하로 제한되고, 예약 시 결합상품 가용이 감소한다', async () => {
    const { client } = await createEphemeralSession()
    const pkg = await createProduct('패키지', 3)
    const b = await createProduct('결합', 1)
    await linkBundles(pkg.parentId, [b.parentId])
    const s0 = await stock(client, [pkg.parentId, b.parentId])
    expect(s0[b.parentId]).toBe(1)
    expect(s0[pkg.parentId]).toBe(1)

    const { start, end } = randomFutureRange()
    const pk = await hold(client, pkg.parentId, start, end)
    expect(pk.success).toBe(true)
    const s1 = await stock(client, [pkg.parentId, b.parentId])
    expect(s1[b.parentId]).toBe(0)
    expect(s1[pkg.parentId]).toBe(0)
  })
})

describe('[TDD] 옵션 수량 가드 무회귀 (P2-5)', () => {
  it('set_reservation_options 가드는 결합 점유와 무관하게 기존대로 동작한다(별도 스위트 setReservationOptionsStockGuard가 정본)', async () => {
    const { client } = await createEphemeralSession()
    const main = await createProduct('메인', 1)
    const opt = await createProduct('옵션', 1)
    const { data, error } = await client.rpc('create_draft_reservation', { p_product_id: main.parentId })
    expect(error).toBeNull()
    const id = ((data as Array<{ reservation_id: number }>)[0]).reservation_id
    const ok = await client.rpc('set_reservation_options', {
      p_reservation_id: id,
      p_options: [{ option_product_id: opt.parentId, option_name: '옵션', qty: 1, unit_price: 0 }],
    })
    expect(ok.error).toBeNull()
    const over = await client.rpc('set_reservation_options', {
      p_reservation_id: id,
      p_options: [{ option_product_id: opt.parentId, option_name: '옵션', qty: 2, unit_price: 0 }],
    })
    expect(over.error).not.toBeNull()
  })
})
