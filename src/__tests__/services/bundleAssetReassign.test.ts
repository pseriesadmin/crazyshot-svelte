/**
 * TDD-RED→GREEN: bundleAssetReassign.test.ts
 * 결합상품 실물 재배정 — cms_list_bundle_asset_candidates / cms_reassign_bundle_asset (Migration 652).
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 테스트. fixture는 전부 이 파일이 생성·정리한다.
 * 점유 규칙은 assign_bundle_assets(Migration 547/611)와 동일해야 한다:
 *   비판매 결합상품 = 다른 예약의 메인 배정 + 다른 예약의 결합 배정과 기간 겹침 없음('[]', 종결·draft 제외)
 *   판매전용 결합상품 = 기간 무관, 비종결 예약의 메인/결합 배정에 쓰이지 않음
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'
import { approveTestCustomer } from '../helpers/approveTestCustomer'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

async function createSession(): Promise<{ client: SupabaseClient; userId: string }> {
  const email = `tdd-bundle-reassign-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const password = 'Test1234!'
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`)
  const userId = data.user.id
  await approveTestCustomer(admin, userId)
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

/** 충돌 없는 먼 미래 2일짜리 기간(평일 가정 불필요 — 방식 미지정이라 휴무일 연장 없음) */
function randomRange(): { start: string; end: string } {
  const base = new Date(Date.UTC(2034, 0, 1))
  base.setUTCDate(base.getUTCDate() + Math.floor(Math.random() * 1500))
  const start = fmt(base)
  return { start, end: addDays(start, 1) }
}

async function createProduct(label: string, childCount: number, saleOnly = false): Promise<{ parentId: string; childIds: string[] }> {
  const { data: parent, error } = await admin
    .from('products')
    .insert({ name: `[TDD-BRA] ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, category: 'other', is_active: true, sale_only: saleOnly })
    .select('id')
    .single()
  if (error || !parent) throw new Error(`부모 생성 실패: ${error?.message}`)
  const parentId = (parent as { id: string }).id
  cleanups.push(async () => {
    // 정리는 LIFO라 상품 정리가 사용자(예약) 정리보다 먼저 돈다 — 예약이 상품을 참조 중이면 상품 삭제가 막히므로
    // 이 상품(부모·자식)을 쓰는 예약과 결합 배정을 먼저 지운다.
    const { data: kids } = await admin.from('products').select('id').eq('parent_product_id', parentId)
    const ids = [parentId, ...((kids ?? []) as Array<{ id: string }>).map(k => k.id)]
    await admin.from('reservation_bundle_assets').delete().in('asset_product_id', ids)
    await admin.from('rental_reservations').delete().in('product_id', ids)
    await admin.from('product_bundle_links').delete().or(`product_id.eq.${parentId},bundle_product_id.eq.${parentId}`)
    await admin.from('products').delete().eq('parent_product_id', parentId)
    await admin.from('products').delete().eq('id', parentId)
  })
  const childIds: string[] = []
  for (let i = 0; i < childCount; i++) {
    const { data: c, error: cErr } = await admin
      .from('products')
      .insert({ name: `[TDD-BRA] ${label} 자식${i}`, category: 'other', is_active: true, parent_product_id: parentId, sale_only: saleOnly })
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

async function assetOf(resId: number, bundleParentId: string): Promise<string | null> {
  const { data } = await admin
    .from('reservation_bundle_assets').select('asset_product_id')
    .eq('reservation_id', resId).eq('bundle_product_id', bundleParentId).maybeSingle()
  return (data as { asset_product_id: string } | null)?.asset_product_id ?? null
}

async function candidates(resId: number, bundleParentId: string): Promise<string[]> {
  const { data, error } = await admin.rpc('cms_list_bundle_asset_candidates', {
    p_reservation_id: resId, p_bundle_product_id: bundleParentId,
  })
  if (error) throw new Error(`후보 조회 실패: ${error.message}`)
  return ((data ?? []) as Array<{ id: string }>).map(r => r.id)
}

async function reassign(resId: number, bundleParentId: string, newAssetId: string) {
  const { data, error } = await admin.rpc('cms_reassign_bundle_asset', {
    p_reservation_id: resId, p_bundle_product_id: bundleParentId, p_new_asset_id: newAssetId,
  })
  if (error) throw new Error(`RPC 호출 실패: ${error.message}`)
  return (data as Array<{ success: boolean; error_message: string | null }>)[0]
}

async function insertMainBlocker(userId: string, productId: string, start: string, end: string, status: string): Promise<number> {
  const { data, error } = await admin
    .from('rental_reservations')
    .insert({ user_id: userId, product_id: productId, status, start_date: start, end_date: end })
    .select('id').single()
  if (error || !data) throw new Error(`blocker 생성 실패: ${error?.message}`)
  return (data as { id: number }).id
}

/** 결합상품 1종(자식 3개) + 패키지 1종 + 패키지 hold 예약 */
async function fixture(saleOnlyBundle = false) {
  const { client, userId } = await createSession()
  const pkg = await createProduct('패키지', 1)
  const bundle = await createProduct('결합', 3, saleOnlyBundle)
  await linkBundles(pkg.parentId, [bundle.parentId])
  const range = randomRange()
  const resId = await hold(client, pkg.parentId, range.start, range.end)
  const current = await assetOf(resId, bundle.parentId)
  expect(current).not.toBeNull()
  return { client, userId, pkg, bundle, range, resId, current: current as string }
}

describe('[TDD] 결합상품 실물 재배정 (Migration 652)', () => {
  it('R1: 후보 = 같은 결합상품의 다른 빈 실물(현재 배정 제외)', async () => {
    const f = await fixture()
    const list = await candidates(f.resId, f.bundle.parentId)
    const expected = f.bundle.childIds.filter(id => id !== f.current).sort()
    expect([...list].sort()).toEqual(expected)
  })

  it('R2: 교체 성공 — 배정 행이 바뀌고 옛 실물이 후보로 돌아온다', async () => {
    const f = await fixture()
    const target = (await candidates(f.resId, f.bundle.parentId))[0]
    const r = await reassign(f.resId, f.bundle.parentId, target)
    expect(r.success).toBe(true)
    expect(await assetOf(f.resId, f.bundle.parentId)).toBe(target)
    expect(await candidates(f.resId, f.bundle.parentId)).toContain(f.current)
  })

  it('R3: 다른 예약의 메인 배정과 기간이 겹치는 실물은 후보에서 빠지고 교체도 거부된다', async () => {
    const f = await fixture()
    const other = await createSession()
    const busy = f.bundle.childIds.find(id => id !== f.current) as string
    await insertMainBlocker(other.userId, busy, f.range.end, addDays(f.range.end, 1), 'hold') // 마지막 날 겹침('[]')
    expect(await candidates(f.resId, f.bundle.parentId)).not.toContain(busy)
    const r = await reassign(f.resId, f.bundle.parentId, busy)
    expect(r.success).toBe(false)
    expect(r.error_message).toContain('이미 다른 예약')
    expect(await assetOf(f.resId, f.bundle.parentId)).toBe(f.current)
  })

  it('R4: 다른 패키지 예약의 결합 배정과 겹치는 실물도 막는다', async () => {
    const f = await fixture()
    const other = await createSession()
    const busy = f.bundle.childIds.find(id => id !== f.current) as string
    const filler = await createProduct('필러', 1)
    const fillerRes = await insertMainBlocker(other.userId, filler.childIds[0], f.range.start, f.range.end, 'hold')
    const { error } = await admin.from('reservation_bundle_assets').insert({
      reservation_id: fillerRes, bundle_product_id: f.bundle.parentId, asset_product_id: busy,
    })
    expect(error).toBeNull()
    expect(await candidates(f.resId, f.bundle.parentId)).not.toContain(busy)
    expect((await reassign(f.resId, f.bundle.parentId, busy)).success).toBe(false)
  })

  it('R5: 기간이 겹치지 않는 다른 예약·종결된 예약은 막지 않는다', async () => {
    const f = await fixture()
    const other = await createSession()
    const a = f.bundle.childIds.find(id => id !== f.current) as string
    const b = f.bundle.childIds.find(id => id !== f.current && id !== a) as string
    await insertMainBlocker(other.userId, a, addDays(f.range.end, 5), addDays(f.range.end, 6), 'hold') // 기간 밖
    await insertMainBlocker(other.userId, b, f.range.start, f.range.end, 'cancelled') // 종결
    const list = await candidates(f.resId, f.bundle.parentId)
    expect(list).toContain(a)
    expect(list).toContain(b)
    expect((await reassign(f.resId, f.bundle.parentId, b)).success).toBe(true)
  })

  it('R6: 반출 이후(in_use)·취소·만료 예약은 거부된다', async () => {
    for (const status of ['in_use', 'cancelled', 'expired']) {
      const f = await fixture()
      const target = (await candidates(f.resId, f.bundle.parentId))[0]
      await admin.from('rental_reservations').update({ status }).eq('id', f.resId)
      const r = await reassign(f.resId, f.bundle.parentId, target)
      expect(r.success, status).toBe(false)
      expect(await assetOf(f.resId, f.bundle.parentId)).toBe(f.current)
    }
  })

  it('R7: confirmed 상태는 허용된다', async () => {
    const f = await fixture()
    const target = (await candidates(f.resId, f.bundle.parentId))[0]
    await admin.from('rental_reservations').update({ status: 'confirmed' }).eq('id', f.resId)
    expect((await reassign(f.resId, f.bundle.parentId, target)).success).toBe(true)
  })

  it('R8: 다른 결합상품(다른 부모)의 실물로는 교체할 수 없다', async () => {
    const f = await fixture()
    const stranger = await createProduct('남의결합', 1)
    const r = await reassign(f.resId, f.bundle.parentId, stranger.childIds[0])
    expect(r.success).toBe(false)
    expect(r.error_message).toContain('같은 결합상품')
  })

  it('R9: 비활성·삭제된 실물은 후보에서 빠지고 교체도 거부된다', async () => {
    const f = await fixture()
    const others = f.bundle.childIds.filter(id => id !== f.current)
    await admin.from('products').update({ is_active: false }).eq('id', others[0])
    await admin.from('products').update({ deleted_at: new Date().toISOString() }).eq('id', others[1])
    expect(await candidates(f.resId, f.bundle.parentId)).toEqual([])
    expect((await reassign(f.resId, f.bundle.parentId, others[0])).success).toBe(false)
    expect((await reassign(f.resId, f.bundle.parentId, others[1])).success).toBe(false)
  })

  it('R10: 이미 배정된 같은 실물 / 배정 기록 없는 결합상품은 거부된다', async () => {
    const f = await fixture()
    expect((await reassign(f.resId, f.bundle.parentId, f.current)).error_message).toContain('이미 배정')
    const stranger = await createProduct('기록없음', 1)
    const r = await reassign(f.resId, stranger.parentId, stranger.childIds[0])
    expect(r.success).toBe(false)
    expect(r.error_message).toContain('배정 기록')
    expect(await candidates(f.resId, stranger.parentId)).toEqual([])
  })

  it('R11: 판매전용 결합상품은 기간과 무관하게 비종결 예약에 쓰인 실물을 막는다', async () => {
    const f = await fixture(true)
    const other = await createSession()
    const busy = f.bundle.childIds.find(id => id !== f.current) as string
    const far = addDays(f.range.end, 200) // 이 예약 기간과 전혀 다른 시기
    await insertMainBlocker(other.userId, busy, far, addDays(far, 1), 'hold')
    expect(await candidates(f.resId, f.bundle.parentId)).not.toContain(busy)
    expect((await reassign(f.resId, f.bundle.parentId, busy)).success).toBe(false)
    const free = f.bundle.childIds.find(id => id !== f.current && id !== busy) as string
    expect((await reassign(f.resId, f.bundle.parentId, free)).success).toBe(true)
  })

  it('R12: 서버 전용 — anon·로그인 사용자는 두 RPC를 호출할 수 없다', async () => {
    const f = await fixture()
    const target = f.bundle.childIds.find(id => id !== f.current) as string
    const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    for (const c of [anon, f.client]) {
      const l = await c.rpc('cms_list_bundle_asset_candidates', { p_reservation_id: f.resId, p_bundle_product_id: f.bundle.parentId })
      expect(l.error).not.toBeNull()
      const r = await c.rpc('cms_reassign_bundle_asset', { p_reservation_id: f.resId, p_bundle_product_id: f.bundle.parentId, p_new_asset_id: target })
      expect(r.error).not.toBeNull()
    }
    expect(await assetOf(f.resId, f.bundle.parentId)).toBe(f.current)
  })

  it('R13: 같은 실물로 두 예약이 동시에 교체해도 한쪽만 성공한다(이중 점유 방지)', async () => {
    const f1 = await fixture()
    // 같은 결합상품·같은 기간의 두 번째 패키지 예약 — 자식이 3개뿐이라 둘째 예약은 자식을 하나 더 쓴다
    const other = await createSession()
    const pkg2 = await createProduct('패키지2', 1)
    await linkBundles(pkg2.parentId, [f1.bundle.parentId])
    const res2 = await hold(other.client, pkg2.parentId, f1.range.start, f1.range.end)
    const cur2 = await assetOf(res2, f1.bundle.parentId) as string
    const free = f1.bundle.childIds.find(id => id !== f1.current && id !== cur2) as string
    const [a, b] = await Promise.all([
      reassign(f1.resId, f1.bundle.parentId, free),
      reassign(res2, f1.bundle.parentId, free),
    ])
    expect([a.success, b.success].filter(Boolean)).toHaveLength(1)
    const owners = [await assetOf(f1.resId, f1.bundle.parentId), await assetOf(res2, f1.bundle.parentId)]
    expect(owners.filter(x => x === free)).toHaveLength(1)
  })
})
