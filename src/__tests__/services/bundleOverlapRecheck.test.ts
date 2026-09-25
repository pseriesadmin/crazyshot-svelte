/**
 * TDD-RED: bundleOverlapRecheck.test.ts
 * 결합상품 Phase 2 QA MEDIUM #1 — set_reservation_shipment_method가 휴무일 연장으로 기간을 넓힐 때
 * 결합 실물(reservation_bundle_assets) 겹침을 재검사한다 (Migration 548).
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 테스트. fixture는 전부 이 파일이 생성·정리한다.
 * 결정적 재현: "월요일 수령 + crazydelivery" → 전날(일요일) 휴무 연장으로 start가 하루 당겨진다
 * (setReservationShipmentMethodHolidayExtension.test.ts와 동일 전제).
 * 막을 것: 넓어진 기간에 결합 실물이 다른 예약(메인 배정/다른 패키지 결합 배정)과 겹치는데 통과.
 * 실패 시: 예외로 차단, start/end/연장일수 원복.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const COURIER = 'crazydelivery'

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

async function createSession(): Promise<{ client: SupabaseClient; userId: string }> {
  const email = `tdd-bundle-recheck-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const password = 'Test1234!'
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`)
  const userId = data.user.id
  const asUser = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
  const { error: sErr } = await asUser.auth.signInWithPassword({ email, password })
  if (sErr) throw new Error(`로그인 실패: ${sErr.message}`)
  cleanups.push(async () => {
    await admin.from('rental_reservations').delete().eq('user_id', userId)
    await admin.auth.admin.deleteUser(userId)
  })
  return { client: asUser, userId }
}

const fmt = (d: Date): string => d.toISOString().slice(0, 10)
const addDays = (iso: string, n: number): string => fmt(new Date(new Date(iso + 'T00:00:00Z').getTime() + n * 86400000))

/** 먼 미래 월요일 수령 + 2일 뒤 반납 (전날=일요일) */
function mondayRange(): { start: string; end: string; sunday: string } {
  const base = new Date(Date.UTC(2032, 0, 1))
  const toMonday = (8 - base.getUTCDay()) % 7 || 7
  base.setUTCDate(base.getUTCDate() + toMonday + Math.floor(Math.random() * 300) * 7)
  const start = fmt(base)
  return { start, end: addDays(start, 2), sunday: addDays(start, -1) }
}

async function createProduct(label: string, childCount: number): Promise<{ parentId: string; childIds: string[] }> {
  const { data: parent, error } = await admin
    .from('products')
    .insert({ name: `[TDD-RECHECK] ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, category: 'other', is_active: true })
    .select('id')
    .single()
  if (error || !parent) throw new Error(`부모 생성 실패: ${error?.message}`)
  const parentId = (parent as { id: string }).id
  cleanups.push(async () => {
    await admin.from('product_bundle_links').delete().or(`product_id.eq.${parentId},bundle_product_id.eq.${parentId}`)
    await admin.from('products').delete().eq('parent_product_id', parentId)
    await admin.from('products').delete().eq('id', parentId)
  })
  const childIds: string[] = []
  for (let i = 0; i < childCount; i++) {
    const { data: c, error: cErr } = await admin
      .from('products')
      .insert({ name: `[TDD-RECHECK] ${label} 자식${i}`, category: 'other', is_active: true, parent_product_id: parentId })
      .select('id')
      .single()
    if (cErr || !c) throw new Error(`자식 생성 실패: ${cErr?.message}`)
    childIds.push((c as { id: string }).id)
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

async function hold(client: SupabaseClient, productId: string, start: string, end: string): Promise<number> {
  const { data, error } = await client.rpc('create_hold_reservation', {
    p_product_id: productId, p_start_date: start, p_end_date: end,
  })
  const row = (data as Array<{ success: boolean; reservation_id: number; error_message: string | null }> | null)?.[0]
  if (error || !row?.success) throw new Error(`hold 실패: ${error?.message ?? row?.error_message}`)
  return row.reservation_id
}

function setMethod(client: SupabaseClient, reservationId: number, method: string) {
  return client.rpc('set_reservation_shipment_method', {
    p_reservation_id: reservationId,
    p_pickup_method: method,
    p_return_method: method,
    p_pickup_time: '10:00',
    p_return_time: '10:00',
  })
}

async function fetchRes(id: number) {
  const { data, error } = await admin
    .from('rental_reservations')
    .select('start_date, end_date, pickup_holiday_extra_days, return_holiday_extra_days')
    .eq('id', id).single()
  if (error) throw new Error(`예약 조회 실패: ${error.message}`)
  return data as { start_date: string; end_date: string; pickup_holiday_extra_days: number | null; return_holiday_extra_days: number | null }
}

async function assetsOf(id: number): Promise<string[]> {
  const { data } = await admin.from('reservation_bundle_assets').select('asset_product_id').eq('reservation_id', id)
  return ((data ?? []) as Array<{ asset_product_id: string }>).map(r => r.asset_product_id)
}

/** 결합 실물 1개짜리 패키지 예약(방식 미정) fixture */
async function packageHold(): Promise<{ client: SupabaseClient; resId: number; assetId: string; range: ReturnType<typeof mondayRange> }> {
  const { client } = await createSession()
  const pkg = await createProduct('패키지', 1)
  const bundle = await createProduct('결합X', 1)
  await linkBundles(pkg.parentId, [bundle.parentId])
  const range = mondayRange()
  const resId = await hold(client, pkg.parentId, range.start, range.end)
  const assets = await assetsOf(resId)
  expect(assets).toHaveLength(1)
  return { client, resId, assetId: assets[0], range }
}

async function insertBlocker(userId: string, productId: string, day: string, status: string): Promise<number> {
  const { data, error } = await admin
    .from('rental_reservations')
    .insert({ user_id: userId, product_id: productId, status, start_date: day, end_date: day })
    .select('id').single()
  if (error || !data) throw new Error(`blocker 생성 실패: ${error?.message}`)
  return (data as { id: number }).id
}

describe('[TDD] 방식 변경으로 기간 확대 시 결합 실물 겹침 재검사 (Migration 548)', () => {
  it('E1: 늘어나는 기간에 결합 실물이 다른 예약(메인 배정)과 겹치면 차단되고 기간이 원복된다', async () => {
    const { client, resId, assetId, range } = await packageHold()
    const other = await createSession()
    await insertBlocker(other.userId, assetId, range.sunday, 'hold')

    const { error } = await setMethod(client, resId, COURIER)
    expect(error).not.toBeNull()
    expect(error?.message).toContain('구성품 재고')
    const r = await fetchRes(resId)
    expect(r.start_date).toBe(range.start)
    expect(r.end_date).toBe(range.end)
    expect(r.pickup_holiday_extra_days ?? 0).toBe(0)
  })

  it('E1b: 다른 패키지 예약의 결합 배정과 겹쳐도 차단된다', async () => {
    const { client, resId, assetId, range } = await packageHold()
    const other = await createSession()
    const filler = await createProduct('필러', 1)
    const fillerRes = await insertBlocker(other.userId, filler.childIds[0], range.sunday, 'hold')
    const { data: b } = await admin.from('products').select('parent_product_id').eq('id', assetId).single()
    const { error: insErr } = await admin.from('reservation_bundle_assets').insert({
      reservation_id: fillerRes,
      bundle_product_id: (b as { parent_product_id: string }).parent_product_id,
      asset_product_id: assetId,
    })
    expect(insErr).toBeNull()

    const { error } = await setMethod(client, resId, COURIER)
    expect(error?.message).toContain('구성품 재고')
    expect((await fetchRes(resId)).start_date).toBe(range.start)
  })

  it('E2: 늘어난 기간에도 겹침이 없으면 성공하고 결합 배정이 유지된다', async () => {
    const { client, resId, assetId, range } = await packageHold()
    const { error } = await setMethod(client, resId, COURIER)
    expect(error).toBeNull()
    expect((await fetchRes(resId)).start_date).toBe(range.sunday)
    expect(await assetsOf(resId)).toEqual([assetId])
  })

  it('E3: 결합 배정이 없는 일반 예약은 기존 동작 그대로 연장된다(회귀)', async () => {
    const { client } = await createSession()
    const plain = await createProduct('일반', 1)
    const range = mondayRange()
    const resId = await hold(client, plain.parentId, range.start, range.end)
    const { error } = await setMethod(client, resId, COURIER)
    expect(error).toBeNull()
    expect((await fetchRes(resId)).start_date).toBe(range.sunday)
  })

  it('E4: 자기 자신의 배정 행은 겹침으로 오판하지 않는다(같은 방식 재호출도 성공)', async () => {
    const { client, resId, range } = await packageHold()
    expect((await setMethod(client, resId, COURIER)).error).toBeNull()
    expect((await setMethod(client, resId, COURIER)).error).toBeNull()
    expect((await fetchRes(resId)).start_date).toBe(range.sunday)
  })

  it('E5: 기간이 동일하거나 좁아지면 재검사 없이 통과한다', async () => {
    const { client, resId, assetId, range } = await packageHold()
    expect((await setMethod(client, resId, COURIER)).error).toBeNull()
    const other = await createSession()
    await insertBlocker(other.userId, assetId, range.sunday, 'hold') // 이미 확대된 범위와 겹치는 기존 충돌
    expect((await setMethod(client, resId, COURIER)).error).toBeNull() // 동일
    expect((await setMethod(client, resId, 'visit')).error).toBeNull() // 좁아짐
    expect((await fetchRes(resId)).start_date).toBe(range.start)
  })

  it('E6: 종결 상태 예약에 걸린 점유는 겹침으로 보지 않는다', async () => {
    const { client, resId, assetId, range } = await packageHold()
    const other = await createSession()
    await insertBlocker(other.userId, assetId, range.sunday, 'cancelled')
    expect((await setMethod(client, resId, COURIER)).error).toBeNull()
    expect((await fetchRes(resId)).start_date).toBe(range.sunday)
  })
})
