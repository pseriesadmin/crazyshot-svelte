/**
 * TDD-RED→GREEN: optionAssetAssign.test.ts
 * 옵션상품 실물 배정(reservation_option_assets, Migration 654) — 배정·보정·후보 조회·재배정.
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 테스트. fixture는 전부 이 파일이 생성·정리한다.
 * 규칙: 옵션 1행 × qty = 실물 qty건(부모의 활성 자식), best-effort(부족하면 가능한 만큼만, 저장은 막지 않음),
 *       hold·confirmed만, 판매전용 옵션 제외, 점유 = 다른 비종결 예약의 메인·결합·옵션 배정과 기간 겹침('[]').
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
  const email = `tdd-option-asset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
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

async function createProduct(label: string, childCount: number, saleOnly = false): Promise<{ parentId: string; childIds: string[] }> {
  const { data: parent, error } = await admin
    .from('products')
    .insert({ name: `[TDD-OPA] ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, category: 'other', is_active: true, sale_only: saleOnly })
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
    await admin.from('product_bundle_links').delete().or(`product_id.eq.${parentId},bundle_product_id.eq.${parentId}`)
    await admin.from('products').delete().eq('parent_product_id', parentId)
    await admin.from('products').delete().eq('id', parentId)
  })
  const childIds: string[] = []
  for (let i = 0; i < childCount; i++) {
    const { data: c, error: cErr } = await admin
      .from('products')
      .insert({ name: `[TDD-OPA] ${label} 자식${i}`, category: 'other', is_active: true, parent_product_id: parentId, sale_only: saleOnly })
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

async function setOptions(client: SupabaseClient, resId: number, opts: Array<{ id: string; name: string; qty: number }>) {
  return client.rpc('set_reservation_options', {
    p_reservation_id: resId,
    p_options: opts.map(o => ({ option_product_id: o.id, option_name: o.name, qty: o.qty, unit_price: 1000 })),
  })
}

async function assetsOf(resId: number): Promise<Array<{ id: number; option_id: number; asset: string; parent: string }>> {
  const { data } = await admin.from('reservation_option_assets')
    .select('id, reservation_option_id, asset_product_id, option_product_id').eq('reservation_id', resId).order('id')
  return ((data ?? []) as Array<{ id: number; reservation_option_id: number; asset_product_id: string; option_product_id: string }>)
    .map(r => ({ id: r.id, option_id: r.reservation_option_id, asset: r.asset_product_id, parent: r.option_product_id }))
}

async function candidates(resId: number, assetRowId: number): Promise<string[]> {
  const { data, error } = await admin.rpc('cms_list_option_asset_candidates', { p_reservation_id: resId, p_option_asset_id: assetRowId })
  if (error) throw new Error(`후보 조회 실패: ${error.message}`)
  return ((data ?? []) as Array<{ id: string }>).map(r => r.id)
}

async function reassign(resId: number, assetRowId: number, newAssetId: string) {
  const { data, error } = await admin.rpc('cms_reassign_option_asset', { p_reservation_id: resId, p_option_asset_id: assetRowId, p_new_asset_id: newAssetId })
  if (error) throw new Error(`RPC 호출 실패: ${error.message}`)
  return (data as Array<{ success: boolean; error_message: string | null }>)[0]
}

async function insertMainBlocker(userId: string, productId: string, start: string, end: string, status: string): Promise<number> {
  const { data, error } = await admin.from('rental_reservations')
    .insert({ user_id: userId, product_id: productId, status, start_date: start, end_date: end }).select('id').single()
  if (error || !data) throw new Error(`blocker 생성 실패: ${error?.message}`)
  return (data as { id: number }).id
}

/** 메인(자식 1) + 옵션(자식 n) + hold 예약 */
async function fixture(optChildren = 4, saleOnlyOption = false) {
  const { client, userId } = await createSession()
  const main = await createProduct('메인', 1)
  const opt = await createProduct('옵션', optChildren, saleOnlyOption)
  const range = randomRange()
  const resId = await hold(client, main.parentId, range.start, range.end)
  return { client, userId, main, opt, range, resId }
}

describe('[TDD] 옵션상품 실물 배정 (Migration 654)', () => {
  it('P1: 옵션 저장 시 qty만큼 부모의 활성 자식이 서로 다르게 배정된다', async () => {
    const f = await fixture()
    const { error } = await setOptions(f.client, f.resId, [{ id: f.opt.parentId, name: '옵션A', qty: 2 }])
    expect(error).toBeNull()
    const a = await assetsOf(f.resId)
    expect(a).toHaveLength(2)
    expect(new Set(a.map(x => x.asset)).size).toBe(2)
    for (const x of a) {
      expect(f.opt.childIds).toContain(x.asset)
      expect(x.parent).toBe(f.opt.parentId)
    }
  })

  it('P2: 옵션을 다시 저장하면(delete+insert) 배정이 새 옵션 행 기준으로 다시 만들어진다', async () => {
    const f = await fixture()
    await setOptions(f.client, f.resId, [{ id: f.opt.parentId, name: '옵션A', qty: 2 }])
    const before = await assetsOf(f.resId)
    await setOptions(f.client, f.resId, [{ id: f.opt.parentId, name: '옵션A', qty: 1 }])
    const after = await assetsOf(f.resId)
    expect(after).toHaveLength(1)
    expect(after[0].option_id).not.toBe(before[0].option_id)
    // 옵션을 모두 비우면 배정도 사라진다
    await setOptions(f.client, f.resId, [])
    expect(await assetsOf(f.resId)).toHaveLength(0)
  })

  it('P3: 판매전용 옵션은 배정 대상이 아니다', async () => {
    const f = await fixture(3, true)
    const { error } = await setOptions(f.client, f.resId, [{ id: f.opt.parentId, name: '판매옵션', qty: 1 }])
    expect(error).toBeNull()
    expect(await assetsOf(f.resId)).toHaveLength(0)
  })

  it('P4: 가용 실물이 부족하면 가능한 만큼만 배정하고 저장은 성공한다(best-effort)', async () => {
    const f = await fixture(3)
    const other = await createSession()
    // 자식 2개를 같은 기간에 다른 예약의 메인으로 점유 → 가용 1개
    await insertMainBlocker(other.userId, f.opt.childIds[0], f.range.start, f.range.end, 'hold')
    await insertMainBlocker(other.userId, f.opt.childIds[1], f.range.start, f.range.end, 'hold')
    const { error } = await setOptions(f.client, f.resId, [{ id: f.opt.parentId, name: '옵션A', qty: 2 }])
    expect(error).toBeNull()
    const a = await assetsOf(f.resId)
    expect(a).toHaveLength(1)
    expect(a[0].asset).toBe(f.opt.childIds[2])
    // 점유가 풀리면 보정(ensure)이 나머지를 채운다
    await admin.from('rental_reservations').update({ status: 'cancelled' }).eq('user_id', other.userId)
    await admin.rpc('cms_ensure_reservation_option_assets', { p_reservation_id: f.resId })
    expect(await assetsOf(f.resId)).toHaveLength(2)
  })

  it('P5: 기간이 겹치지 않는 예약·종결된 예약이 쓰는 실물은 배정에서 제외하지 않는다', async () => {
    const f = await fixture(2)
    const other = await createSession()
    await insertMainBlocker(other.userId, f.opt.childIds[0], addDays(f.range.end, 9), addDays(f.range.end, 10), 'hold') // 기간 밖
    await insertMainBlocker(other.userId, f.opt.childIds[1], f.range.start, f.range.end, 'cancelled') // 종결
    await setOptions(f.client, f.resId, [{ id: f.opt.parentId, name: '옵션A', qty: 2 }])
    expect((await assetsOf(f.resId)).map(x => x.asset).sort()).toEqual([...f.opt.childIds].sort())
  })

  it('P6: 보정(ensure) — 옵션 행이 배정 없이 존재해도 채워지고, 여러 번 불러도 중복 배정되지 않는다', async () => {
    const f = await fixture()
    await admin.from('reservation_options').insert({ reservation_id: f.resId, option_product_id: f.opt.parentId, option_name: '레거시', qty: 2, unit_price: 0 })
    expect(await assetsOf(f.resId)).toHaveLength(0)
    await admin.rpc('cms_ensure_reservation_option_assets', { p_reservation_id: f.resId })
    await admin.rpc('cms_ensure_reservation_option_assets', { p_reservation_id: f.resId })
    expect(await assetsOf(f.resId)).toHaveLength(2)
  })

  it('P7: 반출 이후(in_use)·취소 예약은 보정해도 배정하지 않는다(미추적)', async () => {
    for (const status of ['in_use', 'cancelled', 'shipped']) {
      const f = await fixture()
      await admin.from('reservation_options').insert({ reservation_id: f.resId, option_product_id: f.opt.parentId, option_name: '레거시', qty: 1, unit_price: 0 })
      await admin.from('rental_reservations').update({ status }).eq('id', f.resId)
      await admin.rpc('cms_ensure_reservation_option_assets', { p_reservation_id: f.resId })
      expect((await assetsOf(f.resId)).length, status).toBe(0)
    }
  })

  it('P8: 후보 = 같은 옵션의 활성·미삭제·비어 있는 다른 실물(현재 배정·이 예약의 다른 옵션 배정 제외)', async () => {
    const f = await fixture(5)
    await setOptions(f.client, f.resId, [{ id: f.opt.parentId, name: '옵션A', qty: 2 }])
    const [a1, a2] = await assetsOf(f.resId)
    const list = await candidates(f.resId, a1.id)
    expect(list).not.toContain(a1.asset)
    expect(list).not.toContain(a2.asset) // 같은 예약의 다른 옵션 배정은 제외
    expect(list.sort()).toEqual(f.opt.childIds.filter(id => id !== a1.asset && id !== a2.asset).sort())
    // 비활성·삭제 제외
    await admin.from('products').update({ is_active: false }).eq('id', list[0])
    await admin.from('products').update({ deleted_at: new Date().toISOString() }).eq('id', list[1])
    expect(await candidates(f.resId, a1.id)).toHaveLength(list.length - 2)
  })

  it('P9: 다른 예약의 메인·옵션 배정과 기간이 겹치는 실물은 후보에서 빠지고 교체도 거부된다', async () => {
    const f = await fixture(5)
    await setOptions(f.client, f.resId, [{ id: f.opt.parentId, name: '옵션A', qty: 1 }])
    const [a1] = await assetsOf(f.resId)
    const free = f.opt.childIds.filter(id => id !== a1.asset)
    const other = await createSession()
    // 메인 점유
    await insertMainBlocker(other.userId, free[0], f.range.end, addDays(f.range.end, 1), 'hold')
    // 다른 예약의 옵션 배정 점유
    const main3 = await createProduct('메인3', 1)
    const otherRes = await insertMainBlocker(other.userId, main3.childIds[0], f.range.start, f.range.end, 'hold')
    const { data: ro } = await admin.from('reservation_options')
      .insert({ reservation_id: otherRes, option_product_id: f.opt.parentId, option_name: '타예약옵션', qty: 1, unit_price: 0 }).select('id').single()
    await admin.from('reservation_option_assets').insert({
      reservation_id: otherRes, reservation_option_id: (ro as { id: number }).id, option_product_id: f.opt.parentId, asset_product_id: free[1],
    })
    const list = await candidates(f.resId, a1.id)
    expect(list).not.toContain(free[0])
    expect(list).not.toContain(free[1])
    expect(list).toContain(free[2])
    for (const busy of [free[0], free[1]]) {
      const r = await reassign(f.resId, a1.id, busy)
      expect(r.success).toBe(false)
      expect(r.error_message).toContain('이미 다른 예약')
    }
  })

  it('P10: 교체 성공 — 배정이 바뀌고 옛 실물이 후보로 돌아오며, 옵션 행·수량은 그대로다', async () => {
    const f = await fixture()
    await setOptions(f.client, f.resId, [{ id: f.opt.parentId, name: '옵션A', qty: 2 }])
    const [a1] = await assetsOf(f.resId)
    const target = (await candidates(f.resId, a1.id))[0]
    const r = await reassign(f.resId, a1.id, target)
    expect(r.success).toBe(true)
    const after = await assetsOf(f.resId)
    expect(after.find(x => x.id === a1.id)?.asset).toBe(target)
    expect(after).toHaveLength(2)
    expect(await candidates(f.resId, a1.id)).toContain(a1.asset)
    const { data: ro } = await admin.from('reservation_options').select('qty').eq('reservation_id', f.resId).single()
    expect((ro as { qty: number }).qty).toBe(2)
  })

  it('P11: 거부 규칙 — 상태(in_use·cancelled·expired)·같은 실물·다른 옵션의 실물·이 예약의 다른 옵션 배정 실물', async () => {
    const f = await fixture()
    await setOptions(f.client, f.resId, [{ id: f.opt.parentId, name: '옵션A', qty: 2 }])
    const [a1, a2] = await assetsOf(f.resId)
    expect((await reassign(f.resId, a1.id, a1.asset)).error_message).toContain('이미 배정')
    expect((await reassign(f.resId, a1.id, a2.asset)).error_message).toContain('이미 배정된 재고')
    const stranger = await createProduct('남의옵션', 1)
    expect((await reassign(f.resId, a1.id, stranger.childIds[0])).error_message).toContain('같은 옵션상품')
    expect((await reassign(f.resId, 999999999, f.opt.childIds[3])).success).toBe(false)
    const target = (await candidates(f.resId, a1.id))[0]
    for (const status of ['in_use', 'cancelled', 'expired']) {
      await admin.from('rental_reservations').update({ status }).eq('id', f.resId)
      const r = await reassign(f.resId, a1.id, target)
      expect(r.success, status).toBe(false)
    }
    await admin.from('rental_reservations').update({ status: 'confirmed' }).eq('id', f.resId)
    expect((await reassign(f.resId, a1.id, target)).success).toBe(true)
  })

  it('P12: 옵션 배정 점유가 결합상품 후보 판정에도 반영된다(세 점유원이 서로를 본다)', async () => {
    const { client, userId } = await createSession()
    const pkg = await createProduct('패키지', 1)
    const shared = await createProduct('공용', 3) // 결합상품이면서 다른 예약에서 옵션으로도 쓰임
    const { error: le } = await admin.rpc('upsert_product_bundle_links', {
      p_product_id: pkg.parentId, p_bundle_links: [{ bundle_product_id: shared.parentId, display_order: 0 }],
    })
    expect(le).toBeNull()
    const range = randomRange()
    const resId = await hold(client, pkg.parentId, range.start, range.end)
    const { data: cur } = await admin.from('reservation_bundle_assets').select('asset_product_id').eq('reservation_id', resId).single()
    const current = (cur as { asset_product_id: string }).asset_product_id
    const busy = shared.childIds.find(id => id !== current) as string
    const other = await createSession()
    const mainP = await createProduct('메인2', 1)
    const otherRes = await hold(other.client, mainP.parentId, range.start, range.end)
    const { data: ro } = await admin.from('reservation_options')
      .insert({ reservation_id: otherRes, option_product_id: shared.parentId, option_name: '옵션', qty: 1, unit_price: 0 }).select('id').single()
    await admin.from('reservation_option_assets').insert({
      reservation_id: otherRes, reservation_option_id: (ro as { id: number }).id, option_product_id: shared.parentId, asset_product_id: busy,
    })
    void userId
    const { data: cands } = await admin.rpc('cms_list_bundle_asset_candidates', { p_reservation_id: resId, p_bundle_product_id: shared.parentId })
    expect(((cands ?? []) as Array<{ id: string }>).map(c => c.id)).not.toContain(busy)
  })

  it('P15: 같은 예약에서 결합상품 구성품으로 쓰인 실물은 옵션 실물로 배정·후보에 오르지 않는다(한 실물이 두 역할 금지)', async () => {
    const { client } = await createSession()
    const pkg = await createProduct('패키지', 1)
    const shared = await createProduct('공용', 2) // 결합상품이면서 같은 예약의 옵션으로도 담김
    const { error: le } = await admin.rpc('upsert_product_bundle_links', {
      p_product_id: pkg.parentId, p_bundle_links: [{ bundle_product_id: shared.parentId, display_order: 0 }],
    })
    expect(le).toBeNull()
    const range = randomRange()
    const resId = await hold(client, pkg.parentId, range.start, range.end)
    const { data: cur } = await admin.from('reservation_bundle_assets').select('asset_product_id').eq('reservation_id', resId).single()
    const bundleUnit = (cur as { asset_product_id: string }).asset_product_id
    const otherUnit = shared.childIds.find(id => id !== bundleUnit) as string
    const { error } = await setOptions(client, resId, [{ id: shared.parentId, name: '공용옵션', qty: 2 }])
    expect(error).toBeNull()
    const a = await assetsOf(resId)
    // 결합 구성품으로 쓰인 실물을 뺀 1대만 배정된다(qty 2 중 1대는 가용 재고 없음 → best-effort)
    expect(a.map(x => x.asset)).toEqual([otherUnit])
    expect(await candidates(resId, a[0].id)).not.toContain(bundleUnit)
    const r = await reassign(resId, a[0].id, bundleUnit)
    expect(r.success).toBe(false)
  })

  it('P16: 같은 예약의 옵션 배정 실물은 결합상품 후보·재배정에서도 제외된다', async () => {
    const { client } = await createSession()
    const pkg = await createProduct('패키지', 1)
    const shared = await createProduct('공용', 3)
    await admin.rpc('upsert_product_bundle_links', {
      p_product_id: pkg.parentId, p_bundle_links: [{ bundle_product_id: shared.parentId, display_order: 0 }],
    })
    const range = randomRange()
    const resId = await hold(client, pkg.parentId, range.start, range.end)
    const { data: cur } = await admin.from('reservation_bundle_assets').select('asset_product_id').eq('reservation_id', resId).single()
    const bundleUnit = (cur as { asset_product_id: string }).asset_product_id
    await setOptions(client, resId, [{ id: shared.parentId, name: '공용옵션', qty: 1 }])
    const [oa] = await assetsOf(resId)
    expect(oa.asset).not.toBe(bundleUnit)
    const { data: cands } = await admin.rpc('cms_list_bundle_asset_candidates', { p_reservation_id: resId, p_bundle_product_id: shared.parentId })
    expect(((cands ?? []) as Array<{ id: string }>).map(c => c.id)).not.toContain(oa.asset)
    const { data: res } = await admin.rpc('cms_reassign_bundle_asset', { p_reservation_id: resId, p_bundle_product_id: shared.parentId, p_new_asset_id: oa.asset })
    expect((res as Array<{ success: boolean }>)[0].success).toBe(false)
  })

  it('P13: 서버 전용 — anon·로그인 사용자는 새 RPC 3종을 호출할 수 없다', async () => {
    const f = await fixture()
    await setOptions(f.client, f.resId, [{ id: f.opt.parentId, name: '옵션A', qty: 1 }])
    const [a1] = await assetsOf(f.resId)
    const target = f.opt.childIds.find(id => id !== a1.asset) as string
    const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    for (const c of [anon, f.client]) {
      expect((await c.rpc('cms_ensure_reservation_option_assets', { p_reservation_id: f.resId })).error).not.toBeNull()
      expect((await c.rpc('cms_list_option_asset_candidates', { p_reservation_id: f.resId, p_option_asset_id: a1.id })).error).not.toBeNull()
      expect((await c.rpc('cms_reassign_option_asset', { p_reservation_id: f.resId, p_option_asset_id: a1.id, p_new_asset_id: target })).error).not.toBeNull()
    }
    expect((await assetsOf(f.resId))[0].asset).toBe(a1.asset)
  })

  it('P14: 동시에 같은 실물로 교체해도 한쪽만 성공한다(이중 점유 방지)', async () => {
    const f1 = await fixture(3)
    const other = await createSession()
    const main2 = await createProduct('메인2', 1)
    const res2 = await hold(other.client, main2.parentId, f1.range.start, f1.range.end)
    await setOptions(f1.client, f1.resId, [{ id: f1.opt.parentId, name: '옵션A', qty: 1 }])
    await setOptions(other.client, res2, [{ id: f1.opt.parentId, name: '옵션A', qty: 1 }])
    const [a1] = await assetsOf(f1.resId)
    const [a2] = await assetsOf(res2)
    const free = f1.opt.childIds.find(id => id !== a1.asset && id !== a2.asset) as string
    const [x, y] = await Promise.all([reassign(f1.resId, a1.id, free), reassign(res2, a2.id, free)])
    expect([x.success, y.success].filter(Boolean)).toHaveLength(1)
  })
})
