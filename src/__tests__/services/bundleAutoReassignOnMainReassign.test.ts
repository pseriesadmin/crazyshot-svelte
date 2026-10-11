/**
 * TDD-RED→GREEN: bundleAutoReassignOnMainReassign.test.ts
 * 패키지 본체 '상품 코드 재배정'(cms_reassign_reservation_product_code, Migration 653) 실행 시
 * 결합상품별 "다른 가용 재고 중 가장 낮은 품번"으로 자동 재배정되고, 가용 후보가 없으면 현재 배정을 유지한다.
 *
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 테스트. fixture는 전부 이 파일이 생성·정리한다.
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
  const email = `tdd-bundle-auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
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
  const base = new Date(Date.UTC(2036, 0, 1))
  base.setUTCDate(base.getUTCDate() + Math.floor(Math.random() * 1500))
  const start = fmt(base)
  return { start, end: addDays(start, 1) }
}

const tag = (): string => Math.random().toString(36).slice(2, 7).toUpperCase()

/** codes를 주면 자식에 그 품번을 부여한다(오름차순 정렬 검증용) */
async function createProduct(label: string, childCount: number, opts: { saleOnly?: boolean; codes?: string[] } = {}): Promise<{ parentId: string; childIds: string[] }> {
  const { data: parent, error } = await admin
    .from('products')
    .insert({ name: `[TDD-BAR] ${label} ${Date.now()}-${tag()}`, category: 'other', is_active: true, sale_only: opts.saleOnly ?? false })
    .select('id')
    .single()
  if (error || !parent) throw new Error(`부모 생성 실패: ${error?.message}`)
  const parentId = (parent as { id: string }).id
  cleanups.push(async () => {
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
    const row: Record<string, unknown> = { name: `[TDD-BAR] ${label} 자식${i}`, category: 'other', is_active: true, parent_product_id: parentId, sale_only: opts.saleOnly ?? false }
    if (opts.codes?.[i]) row.product_code = opts.codes[i]
    const { data: c, error: cErr } = await admin.from('products').insert(row).select('id').single()
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
  const { data, error } = await client.rpc('create_hold_reservation', { p_product_id: productId, p_start_date: start, p_end_date: end })
  const row = (data as Array<{ success: boolean; reservation_id: number; error_message: string | null }> | null)?.[0]
  if (error || !row?.success) throw new Error(`hold 실패: ${error?.message ?? row?.error_message}`)
  return row.reservation_id
}

async function mainUnitOf(resId: number): Promise<string> {
  const { data } = await admin.from('rental_reservations').select('product_id').eq('id', resId).single()
  return (data as { product_id: string }).product_id
}

async function assetOf(resId: number, bundleParentId: string): Promise<string | null> {
  const { data } = await admin.from('reservation_bundle_assets').select('asset_product_id')
    .eq('reservation_id', resId).eq('bundle_product_id', bundleParentId).maybeSingle()
  return (data as { asset_product_id: string } | null)?.asset_product_id ?? null
}

async function reassignMain(resId: number, newUnitId: string) {
  const { data, error } = await admin.rpc('cms_reassign_reservation_product_code', { p_reservation_id: resId, p_new_unit_id: newUnitId })
  if (error) throw new Error(`RPC 호출 실패: ${error.message}`)
  return (data as Array<{ success: boolean; error_message: string | null }>)[0]
}

async function insertMainBlocker(userId: string, productId: string, start: string, end: string, status: string): Promise<void> {
  const { error } = await admin.from('rental_reservations').insert({ user_id: userId, product_id: productId, status, start_date: start, end_date: end })
  if (error) throw new Error(`blocker 생성 실패: ${error.message}`)
}

/** 패키지(자식 2) + 결합상품들 + hold 예약. 결합 자식은 품번 오름차순이 생성 순서와 다르게(역순) 부여된다. */
async function fixture(opts: { bundleChildren?: number; bundles?: number; saleOnlyBundle?: boolean } = {}) {
  const { client, userId } = await createSession()
  const pkg = await createProduct('패키지', 2)
  const n = opts.bundles ?? 1
  const bundles: Array<{ parentId: string; childIds: string[]; codes: string[] }> = []
  const k = opts.bundleChildren ?? 3
  for (let i = 0; i < n; i++) {
    const prefix = `TDDBAR${tag()}`
    // 생성 순서와 품번 순서를 일부러 반대로: 첫 자식이 가장 큰 번호
    const codes = Array.from({ length: k }, (_, j) => `${prefix}-${String(k - j).padStart(3, '0')}`)
    const b = await createProduct(`결합${i}`, k, { saleOnly: opts.saleOnlyBundle, codes })
    bundles.push({ ...b, codes })
  }
  await linkBundles(pkg.parentId, bundles.map(b => b.parentId))
  const range = randomRange()
  const resId = await hold(client, pkg.parentId, range.start, range.end)
  const mainCurrent = await mainUnitOf(resId)
  const mainTarget = pkg.childIds.find(id => id !== mainCurrent) as string
  return { client, userId, pkg, bundles, range, resId, mainCurrent, mainTarget }
}

describe('[TDD] 본체 재배정 시 결합상품 자동 재배정 (Migration 653)', () => {
  it('B1: 본체 교체 성공 + 결합상품이 다른 가용 재고 중 가장 낮은 품번으로 자동 교체된다', async () => {
    const f = await fixture()
    const b = f.bundles[0]
    const before = await assetOf(f.resId, b.parentId)
    const r = await reassignMain(f.resId, f.mainTarget)
    expect(r.success).toBe(true)
    expect(await mainUnitOf(f.resId)).toBe(f.mainTarget)
    const after = await assetOf(f.resId, b.parentId)
    expect(after).not.toBe(before)
    // 현재 배정을 뺀 나머지 중 품번이 가장 낮은 자식
    const { data } = await admin.from('products').select('id, product_code').in('id', b.childIds)
    const expected = ((data ?? []) as Array<{ id: string; product_code: string }>)
      .filter(c => c.id !== before).sort((x, y) => x.product_code.localeCompare(y.product_code))[0].id
    expect(after).toBe(expected)
  })

  it('B2: 결합상품이 여러 종이면 종마다 각각 자동 교체된다', async () => {
    const f = await fixture({ bundles: 2 })
    const befores = await Promise.all(f.bundles.map(b => assetOf(f.resId, b.parentId)))
    expect((await reassignMain(f.resId, f.mainTarget)).success).toBe(true)
    for (let i = 0; i < f.bundles.length; i++) {
      const after = await assetOf(f.resId, f.bundles[i].parentId)
      expect(after).not.toBe(befores[i])
      expect(f.bundles[i].childIds).toContain(after)
    }
  })

  it('B3: 다른 가용 재고가 없으면 현재 배정을 유지하고 본체 교체는 성공한다', async () => {
    const f = await fixture({ bundleChildren: 1 })
    const before = await assetOf(f.resId, f.bundles[0].parentId)
    const r = await reassignMain(f.resId, f.mainTarget)
    expect(r.success).toBe(true)
    expect(await mainUnitOf(f.resId)).toBe(f.mainTarget)
    expect(await assetOf(f.resId, f.bundles[0].parentId)).toBe(before)
  })

  it('B4: 다른 예약이 점유 중인 결합 재고는 건너뛰고 다음으로 낮은 품번을 고른다', async () => {
    const f = await fixture({ bundleChildren: 3 })
    const b = f.bundles[0]
    const before = await assetOf(f.resId, b.parentId) as string
    const { data } = await admin.from('products').select('id, product_code').in('id', b.childIds)
    const others = ((data ?? []) as Array<{ id: string; product_code: string }>)
      .filter(c => c.id !== before).sort((x, y) => x.product_code.localeCompare(y.product_code))
    const other = await createSession()
    await insertMainBlocker(other.userId, others[0].id, f.range.start, f.range.end, 'hold') // 가장 낮은 번호 점유
    expect((await reassignMain(f.resId, f.mainTarget)).success).toBe(true)
    expect(await assetOf(f.resId, b.parentId)).toBe(others[1].id)
  })

  it('B5: 본체 교체가 거부되면(반출 이후 상태) 결합 배정도 그대로다', async () => {
    const f = await fixture()
    const before = await assetOf(f.resId, f.bundles[0].parentId)
    await admin.from('rental_reservations').update({ status: 'in_use' }).eq('id', f.resId)
    const r = await reassignMain(f.resId, f.mainTarget)
    expect(r.success).toBe(false)
    expect(await mainUnitOf(f.resId)).toBe(f.mainCurrent)
    expect(await assetOf(f.resId, f.bundles[0].parentId)).toBe(before)
  })

  it('B6: 결합상품이 없는 일반 상품 예약은 기존 동작 그대로다(회귀)', async () => {
    const { client } = await createSession()
    const plain = await createProduct('일반', 2)
    const range = randomRange()
    const resId = await hold(client, plain.parentId, range.start, range.end)
    const current = await mainUnitOf(resId)
    const target = plain.childIds.find(id => id !== current) as string
    expect((await reassignMain(resId, target)).success).toBe(true)
    expect(await mainUnitOf(resId)).toBe(target)
    const { count } = await admin.from('reservation_bundle_assets').select('id', { count: 'exact', head: true }).eq('reservation_id', resId)
    expect(count).toBe(0)
  })

  it('B7: 판매전용 결합상품은 비종결 예약에 쓰이지 않은 재고로만 교체된다', async () => {
    const f = await fixture({ saleOnlyBundle: true, bundleChildren: 3 })
    const b = f.bundles[0]
    const before = await assetOf(f.resId, b.parentId) as string
    const { data } = await admin.from('products').select('id, product_code').in('id', b.childIds)
    const others = ((data ?? []) as Array<{ id: string; product_code: string }>)
      .filter(c => c.id !== before).sort((x, y) => x.product_code.localeCompare(y.product_code))
    const other = await createSession()
    const far = addDays(f.range.end, 300) // 기간이 전혀 다른 시기에도 판매전용은 점유로 본다
    await insertMainBlocker(other.userId, others[0].id, far, addDays(far, 1), 'hold')
    expect((await reassignMain(f.resId, f.mainTarget)).success).toBe(true)
    expect(await assetOf(f.resId, b.parentId)).toBe(others[1].id)
  })

  it('B8: 결합상품 직접 재배정(#652)은 계속 동작한다 — 본체 자동 재배정과 공존', async () => {
    const f = await fixture({ bundleChildren: 3 })
    const b = f.bundles[0]
    expect((await reassignMain(f.resId, f.mainTarget)).success).toBe(true)
    const afterAuto = await assetOf(f.resId, b.parentId) as string
    const { data: cands } = await admin.rpc('cms_list_bundle_asset_candidates', { p_reservation_id: f.resId, p_bundle_product_id: b.parentId })
    const target = ((cands ?? []) as Array<{ id: string }>)[0].id
    const { data: res } = await admin.rpc('cms_reassign_bundle_asset', { p_reservation_id: f.resId, p_bundle_product_id: b.parentId, p_new_asset_id: target })
    expect((res as Array<{ success: boolean }>)[0].success).toBe(true)
    expect(await assetOf(f.resId, b.parentId)).toBe(target)
    expect(target).not.toBe(afterAuto)
  })
})
