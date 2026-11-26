/**
 * optionPackageComponentAssets.test.ts — Migration #854 (2026-11-26, Stephen 지시 "패키지 옵션 구성품 재고 점유 반영")
 * 패키지형 상품을 옵션으로 담으면 그 패키지의 구성품(결합상품)도 옵션 qty만큼 실물을 점유·배정한다.
 *
 * 구조: 구성품 점유 행은 reservation_option_assets 에 저장한다(via_package_product_id = 옵션 패키지, option_product_id = 구성품 부모).
 *       기존 점유 판정(메인·결합·옵션 배정·가용재고)이 이 표를 이미 보므로 모든 경로에서 구성품 재고가 자동으로 차감된다.
 * 규칙: hold 상태의 옵션 저장 시 구성품이 모자라면 OPTION_STOCK_EXCEEDED 로 저장 전체 거부(이중 예약 방지, 패키지 본체 배정은 기존대로 best-effort).
 *       draft→hold 승격(promote_draft_reservation)에서도 구성품이 모자라면 승격 실패. 판매전용 구성품은 대상 아님. 관리자 보정(ensure)은 best-effort.
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 테스트. fixture는 전부 이 파일이 생성·정리한다.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
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
}, 60000)

async function createSession(): Promise<{ client: SupabaseClient; userId: string }> {
  const email = `tdd-opt-pkg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
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
function randomRange(): { start: string; end: string } {
  const base = new Date(Date.UTC(2038, 0, 1))
  base.setUTCDate(base.getUTCDate() + Math.floor(Math.random() * 1500))
  const start = fmt(base)
  return { start, end: addDays(start, 1) }
}

async function createProduct(label: string, childCount: number, extra: Record<string, unknown> = {}): Promise<{ parentId: string; childIds: string[] }> {
  const { data: parent, error } = await admin
    .from('products')
    .insert({ name: `[TDD-OPK] ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, category: 'other', is_active: true, ...extra })
    .select('id').single()
  if (error || !parent) throw new Error(`부모 생성 실패: ${error?.message}`)
  const parentId = (parent as { id: string }).id
  cleanups.push(async () => {
    const { data: kids } = await admin.from('products').select('id').eq('parent_product_id', parentId)
    const ids = [parentId, ...((kids ?? []) as Array<{ id: string }>).map(k => k.id)]
    await admin.from('reservation_option_assets').delete().in('asset_product_id', ids)
    await admin.from('reservation_option_assets').delete().in('option_product_id', ids)
    await admin.from('reservation_options').delete().in('option_product_id', ids)
    await admin.from('reservation_bundle_assets').delete().in('asset_product_id', ids)
    await admin.from('rental_reservations').delete().in('product_id', ids)
    await admin.from('product_option_links').delete().or(`product_id.eq.${parentId},option_product_id.eq.${parentId}`)
    await admin.from('product_bundle_links').delete().or(`product_id.eq.${parentId},bundle_product_id.eq.${parentId}`)
    await admin.from('products').delete().eq('parent_product_id', parentId)
    await admin.from('products').delete().eq('id', parentId)
  })
  const childIds: string[] = []
  for (let i = 0; i < childCount; i++) {
    const { data: c, error: cErr } = await admin
      .from('products')
      .insert({ name: `[TDD-OPK] ${label} 자식${i}`, category: 'other', is_active: true, parent_product_id: parentId, ...extra })
      .select('id').single()
    if (cErr || !c) throw new Error(`자식 생성 실패: ${cErr?.message}`)
    childIds.push((c as { id: string }).id)
  }
  return { parentId, childIds }
}

async function hold(client: SupabaseClient, productId: string, start: string, end: string): Promise<number> {
  const { data, error } = await client.rpc('create_hold_reservation', { p_product_id: productId, p_start_date: start, p_end_date: end })
  const row = (data as Array<{ success: boolean; reservation_id: number; error_message: string | null }> | null)?.[0]
  if (error || !row?.success) throw new Error(`hold 실패: ${error?.message ?? row?.error_message}`)
  return row.reservation_id
}

async function tryHold(client: SupabaseClient, productId: string, start: string, end: string): Promise<boolean> {
  const { data } = await client.rpc('create_hold_reservation', { p_product_id: productId, p_start_date: start, p_end_date: end })
  return !!(data as Array<{ success: boolean }> | null)?.[0]?.success
}

async function setOptions(client: SupabaseClient, resId: number, opts: Array<{ id: string; name: string; qty: number }>) {
  return client.rpc('set_reservation_options', {
    p_reservation_id: resId,
    p_options: opts.map(o => ({ option_product_id: o.id, option_name: o.name, qty: o.qty, unit_price: 1000 })),
  })
}

interface AssetRow { id: number; option_id: number; asset: string; parent: string; via: string | null }
async function assetsOf(resId: number): Promise<AssetRow[]> {
  const { data } = await admin.from('reservation_option_assets')
    .select('id, reservation_option_id, asset_product_id, option_product_id, via_package_product_id').eq('reservation_id', resId).order('id')
  return ((data ?? []) as Array<{ id: number; reservation_option_id: number; asset_product_id: string; option_product_id: string; via_package_product_id: string | null }>)
    .map(r => ({ id: r.id, option_id: r.reservation_option_id, asset: r.asset_product_id, parent: r.option_product_id, via: r.via_package_product_id }))
}

/** 메인(자식 1) + 옵션 패키지 P(자식 pKids, 구성품 C1·C2 각 cKids) + P를 옵션으로 연결 + hold 예약 */
async function fixture(opts: { pKids?: number; c1Kids?: number; c2Kids?: number; c2Extra?: Record<string, unknown> } = {}) {
  const { client, userId } = await createSession()
  const main = await createProduct('메인', 1)
  const pkg = await createProduct('옵션패키지', opts.pKids ?? 3, { is_bundle_product: true })
  const c1 = await createProduct('구성품1', opts.c1Kids ?? 2)
  const c2 = await createProduct('구성품2', opts.c2Kids ?? 2, opts.c2Extra ?? {})
  const link = await admin.rpc('upsert_product_bundle_links', {
    p_product_id: pkg.parentId,
    p_bundle_links: [
      { bundle_product_id: c1.parentId, display_order: 0 },
      { bundle_product_id: c2.parentId, display_order: 1 },
    ],
  })
  if (link.error) throw new Error(`결합 연결 실패: ${link.error.message}`)
  await admin.from('product_option_links').insert({ product_id: main.parentId, option_product_id: pkg.parentId, display_order: 0 })
  const range = randomRange()
  const resId = await hold(client, main.parentId, range.start, range.end)
  return { client, userId, main, pkg, c1, c2, range, resId }
}

describe('[TDD] 패키지 옵션 구성품 재고 점유 (Migration 854)', () => {
  it('PC-1: 패키지 옵션 qty=1 저장 시 구성품마다 실물 1개가 점유되고, 패키지 본체 실물과 구분된다', async () => {
    const f = await fixture()
    const { error } = await setOptions(f.client, f.resId, [{ id: f.pkg.parentId, name: '패키지옵션', qty: 1 }])
    expect(error).toBeNull()
    const a = await assetsOf(f.resId)
    const own = a.filter(x => x.via === null)
    const comp = a.filter(x => x.via === f.pkg.parentId)
    expect(own).toHaveLength(1)
    expect(f.pkg.childIds).toContain(own[0].asset)
    expect(comp).toHaveLength(2)
    expect(comp.map(x => x.parent).sort()).toEqual([f.c1.parentId, f.c2.parentId].sort())
    expect(f.c1.childIds.concat(f.c2.childIds)).toEqual(expect.arrayContaining(comp.map(x => x.asset)))
  })

  it('PC-2: qty=2 이면 구성품마다 서로 다른 실물 2개씩 점유된다', async () => {
    const f = await fixture()
    const { error } = await setOptions(f.client, f.resId, [{ id: f.pkg.parentId, name: '패키지옵션', qty: 2 }])
    expect(error).toBeNull()
    const comp = (await assetsOf(f.resId)).filter(x => x.via === f.pkg.parentId)
    expect(comp).toHaveLength(4)
    expect(new Set(comp.map(x => x.asset)).size).toBe(4)
  })

  it('PC-3: 구성품 재고가 모자라면 OPTION_STOCK_EXCEEDED 로 옵션 저장 전체가 거부된다(이중 예약 방지)', async () => {
    const f = await fixture({ c1Kids: 1 })
    const other = await createSession()
    await admin.from('rental_reservations').insert({ user_id: other.userId, product_id: f.c1.childIds[0], status: 'hold', start_date: f.range.start, end_date: f.range.end })
    const { error } = await setOptions(f.client, f.resId, [{ id: f.pkg.parentId, name: '패키지옵션', qty: 1 }])
    expect(error?.message).toContain('OPTION_STOCK_EXCEEDED')
    expect(await assetsOf(f.resId)).toHaveLength(0)
    const { data } = await admin.from('reservation_options').select('id').eq('reservation_id', f.resId)
    expect(data ?? []).toHaveLength(0)
  })

  it('PC-4: 점유된 구성품은 같은 기간 다른 예약에서 메인으로 예약할 수 없다', async () => {
    const f = await fixture({ c1Kids: 1 })
    await setOptions(f.client, f.resId, [{ id: f.pkg.parentId, name: '패키지옵션', qty: 1 }])
    const other = await createSession()
    expect(await tryHold(other.client, f.c1.parentId, f.range.start, f.range.end)).toBe(false)
    // 기간이 다르면 예약 가능
    expect(await tryHold(other.client, f.c1.parentId, addDays(f.range.end, 9), addDays(f.range.end, 10))).toBe(true)
  })

  it('PC-5: 예약이 취소되면 구성품 점유가 풀린다', async () => {
    const f = await fixture({ c1Kids: 1 })
    await setOptions(f.client, f.resId, [{ id: f.pkg.parentId, name: '패키지옵션', qty: 1 }])
    await admin.from('rental_reservations').update({ status: 'cancelled' }).eq('id', f.resId)
    const other = await createSession()
    expect(await tryHold(other.client, f.c1.parentId, f.range.start, f.range.end)).toBe(true)
  })

  it('PC-6: 옵션을 다시 저장(수량 변경·비우기)하면 구성품 점유도 함께 갱신·해제된다', async () => {
    const f = await fixture()
    await setOptions(f.client, f.resId, [{ id: f.pkg.parentId, name: '패키지옵션', qty: 2 }])
    expect((await assetsOf(f.resId)).filter(x => x.via === f.pkg.parentId)).toHaveLength(4)
    await setOptions(f.client, f.resId, [{ id: f.pkg.parentId, name: '패키지옵션', qty: 1 }])
    expect((await assetsOf(f.resId)).filter(x => x.via === f.pkg.parentId)).toHaveLength(2)
    await setOptions(f.client, f.resId, [])
    expect(await assetsOf(f.resId)).toHaveLength(0)
  })

  it('PC-7: 판매전용 구성품은 점유 대상이 아니다(오류 없이 나머지만 점유)', async () => {
    const f = await fixture({ c2Extra: { sale_only: true } })
    const { error } = await setOptions(f.client, f.resId, [{ id: f.pkg.parentId, name: '패키지옵션', qty: 1 }])
    expect(error).toBeNull()
    const comp = (await assetsOf(f.resId)).filter(x => x.via === f.pkg.parentId)
    expect(comp).toHaveLength(1)
    expect(comp[0].parent).toBe(f.c1.parentId)
  })

  it('PC-8: 관리자 보정(ensure)을 여러 번 불러도 구성품·본체 배정이 중복되지 않고 서로 섞이지 않는다', async () => {
    const f = await fixture()
    await setOptions(f.client, f.resId, [{ id: f.pkg.parentId, name: '패키지옵션', qty: 1 }])
    await admin.rpc('cms_ensure_reservation_option_assets', { p_reservation_id: f.resId })
    await admin.rpc('cms_ensure_reservation_option_assets', { p_reservation_id: f.resId })
    const a = await assetsOf(f.resId)
    expect(a.filter(x => x.via === null)).toHaveLength(1)
    expect(a.filter(x => x.via === f.pkg.parentId)).toHaveLength(2)
  })

  it('PC-9: 같은 예약에서 메인 패키지의 결합 구성품으로 쓰인 실물은 옵션 구성품으로 다시 점유하지 않는다', async () => {
    const f = await fixture({ c1Kids: 1 })
    // 메인(P0)에 같은 C1 을 결합 구성품으로 연결 → 메인 hold 가 C1 의 유일한 실물을 점유
    const main2 = await createProduct('메인2', 1, { is_bundle_product: true })
    await admin.rpc('upsert_product_bundle_links', { p_product_id: main2.parentId, p_bundle_links: [{ bundle_product_id: f.c1.parentId, display_order: 0 }] })
    const s = await createSession()
    const res2 = await hold(s.client, main2.parentId, f.range.start, f.range.end)
    const { error } = await setOptions(s.client, res2, [{ id: f.pkg.parentId, name: '패키지옵션', qty: 1 }])
    expect(error?.message).toContain('OPTION_STOCK_EXCEEDED')
  })

  it('PC-10: draft→hold 승격 시 구성품이 모자라면 승격이 실패하고, 충분하면 구성품이 점유된다', async () => {
    const f = await fixture({ c1Kids: 1 })
    const s = await createSession()
    const { data: d } = await s.client.rpc('create_draft_reservation', { p_product_id: f.main.parentId })
    const draftId = (d as Array<{ success: boolean; reservation_id: number }> | null)?.[0]?.reservation_id
    expect(draftId).toBeTruthy()
    const opt = await setOptions(s.client, draftId as number, [{ id: f.pkg.parentId, name: '패키지옵션', qty: 1 }])
    expect(opt.error).toBeNull()
    // 다른 예약이 같은 기간 C1 유일 실물을 이미 점유
    const other = await createSession()
    await admin.from('rental_reservations').insert({ user_id: other.userId, product_id: f.c1.childIds[0], status: 'hold', start_date: f.range.start, end_date: f.range.end })
    // 메인 재고는 fixture 의 hold 가 이미 차지했으므로 메인 자식을 하나 더 만든다
    await admin.from('products').insert({ name: '[TDD-OPK] 메인 자식추가', category: 'other', is_active: true, parent_product_id: f.main.parentId })
    const fail = await s.client.rpc('promote_draft_reservation', { p_reservation_id: draftId, p_start_date: f.range.start, p_end_date: f.range.end })
    expect((fail.data as Array<{ success: boolean }> | null)?.[0]?.success).toBe(false)
    // 점유가 풀리면 승격 성공 + 구성품 점유
    await admin.from('rental_reservations').update({ status: 'cancelled' }).eq('user_id', other.userId)
    const ok = await s.client.rpc('promote_draft_reservation', { p_reservation_id: draftId, p_start_date: f.range.start, p_end_date: f.range.end })
    expect((ok.data as Array<{ success: boolean }> | null)?.[0]?.success).toBe(true)
    const comp = (await assetsOf(draftId as number)).filter(x => x.via === f.pkg.parentId)
    expect(comp).toHaveLength(2)
  })
})

describe('수량 본상품 연동 보정 경로 (Migration 855, sp3 MAJOR-1)', () => {
  it('PC-11: 주문 생성 직전 수량 연동 보정으로 패키지 옵션 qty 가 바뀌면 구성품 점유도 새 qty 로 맞춰진다', async () => {
    const { ensure24hPriceRule } = await import('../helpers/ensure24hPriceRule')
    const { userId } = await createSession()
    const main = await createProduct('연동메인', 3)
    const pkg = await createProduct('연동패키지', 5, { is_bundle_product: true })
    const c1 = await createProduct('연동구성품', 5)
    expect((await admin.rpc('upsert_product_bundle_links', { p_product_id: pkg.parentId, p_bundle_links: [{ bundle_product_id: c1.parentId, display_order: 0 }] })).error).toBeNull()
    await admin.from('product_option_links').insert({ product_id: main.parentId, option_product_id: pkg.parentId, qty_follows_main: true })
    const start = '2031-05-05', end = '2031-05-06'
    const ids: number[] = []
    for (const childId of main.childIds) {
      await ensure24hPriceRule(admin, childId)
      // eslint-disable-next-line no-restricted-syntax -- 테스트 픽스처: 같은 날짜 hold 그룹 행이 필요(배정 RPC와 무관한 보정 경로 검증)
      const { data, error } = await admin.from('rental_reservations')
        .insert({ product_id: childId, user_id: userId, start_date: start, end_date: end, pickup_time: '10:00', return_time: '10:00', pickup_method: 'visit', return_method: 'visit', duration_type: '24h', status: 'hold' })
        .select('id').single()
      if (error || !data) throw new Error(`hold 예약 생성 실패: ${error?.message}`)
      ids.push((data as { id: number }).id)
    }
    ids.sort((a, b) => a - b)
    cleanups.push(async () => {
      const { data: items } = await admin.from('order_items').select('order_id').in('reservation_id', ids)
      await admin.from('order_items').delete().in('reservation_id', ids)
      for (const it of (items ?? []) as Array<{ order_id: number }>) {
        await admin.from('order_coupons').delete().eq('order_id', it.order_id)
        await admin.from('orders').delete().eq('id', it.order_id)
      }
      await admin.from('reservation_option_assets').delete().in('reservation_id', ids)
      await admin.from('reservation_options').delete().in('reservation_id', ids)
      await admin.from('rental_reservations').delete().in('id', ids)
    })
    // 낡은 상태: 옵션 qty 1 만 저장, 구성품은 1건만 점유
    await admin.from('reservation_options').insert({ reservation_id: ids[0], option_product_id: pkg.parentId, option_name: '연동', qty: 1, unit_price: 0 })
    await admin.rpc('cms_ensure_reservation_option_assets', { p_reservation_id: ids[0] })
    expect((await assetsOf(ids[0])).filter(x => x.via === pkg.parentId)).toHaveLength(1)

    const { error } = await admin.rpc('create_reservation_order', {
      p_user_id: userId, p_reservation_ids: ids, p_selected_coupon_id: null, p_selected_points: 0, p_delivery_fee: 0,
    })
    expect(error).toBeNull()
    const { data: ro } = await admin.from('reservation_options').select('qty').eq('reservation_id', ids[0]).eq('option_product_id', pkg.parentId).single()
    expect((ro as { qty: number }).qty).toBe(3)
    const a = await assetsOf(ids[0])
    expect(a.filter(x => x.via === null)).toHaveLength(3)
    expect(a.filter(x => x.via === pkg.parentId)).toHaveLength(3)
  })
})

describe('화면·API 연결 (Migration 854)', () => {
  const read = (p: string): string => readFileSync(p, 'utf8')

  it('PCA-UI-1: 옵션 실물 배정 API·계약서 데이터가 구성품 점유 행을 옵션 실물 목록에서 제외한다', () => {
    expect(read('src/routes/api/cms/reservations/[id]/options/assets/+server.ts')).toContain("via_package_product_id', null")
    expect(read('src/routes/api/cms/reservations/[id]/contract-data/+server.ts')).toContain("via_package_product_id', null")
  })
})
