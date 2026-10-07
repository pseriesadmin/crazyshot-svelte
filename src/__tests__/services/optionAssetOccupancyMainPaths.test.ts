/**
 * TDD-RED→GREEN: optionAssetOccupancyMainPaths.test.ts
 * sp3-qa 2차 MAJOR-1 후속 — 옵션 배정(reservation_option_assets) 점유를 "메인 신규 배정·승격·결합 자동 배정·본체 재배정·가용재고 집계"도 본다
 * (Migration 657). 이전에는 옵션이 먼저 배정된 실물을 이 경로들이 모르고 같은 기간에 다시 잡을 수 있었다(이중 점유).
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
  const email = `tdd-opt-occ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
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
  const base = new Date(Date.UTC(2040, 0, 1))
  base.setUTCDate(base.getUTCDate() + Math.floor(Math.random() * 1500))
  const start = fmt(base)
  return { start, end: addDays(start, 1) }
}

async function createProduct(label: string, childCount: number): Promise<{ parentId: string; childIds: string[] }> {
  const { data: parent, error } = await admin
    .from('products')
    .insert({ name: `[TDD-OOM] ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, category: 'other', is_active: true })
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
      .insert({ name: `[TDD-OOM] ${label} 자식${i}`, category: 'other', is_active: true, parent_product_id: parentId })
      .select('id').single()
    if (cErr || !c) throw new Error(`자식 생성 실패: ${cErr?.message}`)
    childIds.push((c as { id: string }).id)
  }
  return { parentId, childIds }
}

async function hold(client: SupabaseClient, productId: string, start: string, end: string) {
  const { data, error } = await client.rpc('create_hold_reservation', { p_product_id: productId, p_start_date: start, p_end_date: end })
  if (error) throw new Error(`hold RPC 실패: ${error.message}`)
  return (data as Array<{ success: boolean; reservation_id: number; error_message: string | null }>)[0]
}

async function mainUnitOf(resId: number): Promise<string> {
  const { data } = await admin.from('rental_reservations').select('product_id').eq('id', resId).single()
  return (data as { product_id: string }).product_id
}

/** 예약 A: 메인(자식1) hold + 옵션 P(qty) 저장 → 옵션 배정 생성. 배정된 실물 id 목록 반환 */
async function reservationWithOption(optParentId: string, range: { start: string; end: string }, qty = 1) {
  const s = await createSession()
  const main = await createProduct('메인A', 1)
  const h = await hold(s.client, main.parentId, range.start, range.end)
  expect(h.success).toBe(true)
  const { error } = await s.client.rpc('set_reservation_options', {
    p_reservation_id: h.reservation_id,
    p_options: [{ option_product_id: optParentId, option_name: '옵션P', qty, unit_price: 0 }],
  })
  expect(error).toBeNull()
  const { data } = await admin.from('reservation_option_assets').select('asset_product_id').eq('reservation_id', h.reservation_id).order('id')
  const assets = ((data ?? []) as Array<{ asset_product_id: string }>).map(r => r.asset_product_id)
  expect(assets).toHaveLength(qty)
  return { ...s, resId: h.reservation_id, assets }
}

describe('[TDD] 옵션 배정 점유를 보는 메인·결합·재배정·집계 경로 (Migration 657)', () => {
  it('O1: create_hold_reservation — 같은 기간 다른 예약의 옵션 배정 실물은 메인으로 잡지 않는다', async () => {
    const p = await createProduct('공용P', 2)
    const range = randomRange()
    const a = await reservationWithOption(p.parentId, range)
    const b = await createSession()
    const h = await hold(b.client, p.parentId, range.start, range.end)
    expect(h.success).toBe(true)
    const unit = await mainUnitOf(h.reservation_id)
    expect(unit).not.toBe(a.assets[0])
    expect(p.childIds).toContain(unit)
  })

  it('O2: 가용 재고가 옵션 배정으로 모두 점유되면 메인 예약은 "재고 없음"으로 거절된다', async () => {
    const p = await createProduct('공용P', 1)
    const range = randomRange()
    await reservationWithOption(p.parentId, range)
    const b = await createSession()
    const h = await hold(b.client, p.parentId, range.start, range.end)
    expect(h.success).toBe(false)
    expect(h.error_message).toContain('재고가 없습니다')
  })

  it('O3: 기간이 겹치지 않거나 옵션 예약이 취소됐으면 점유로 보지 않는다(회귀)', async () => {
    const p = await createProduct('공용P', 1)
    const range = randomRange()
    const a = await reservationWithOption(p.parentId, range)
    const b = await createSession()
    // 겹치지 않는 기간
    const later = { start: addDays(range.end, 5), end: addDays(range.end, 6) }
    const ok1 = await hold(b.client, p.parentId, later.start, later.end)
    expect(ok1.success).toBe(true)
    // 옵션 예약 취소 → 해제
    await admin.from('rental_reservations').update({ status: 'cancelled' }).eq('id', a.resId)
    const b2 = await createSession()
    const ok2 = await hold(b2.client, p.parentId, range.start, range.end)
    expect(ok2.success).toBe(true)
  })

  it('O4: promote_draft_reservation — draft 승격 때도 옵션 배정 실물은 건너뛴다', async () => {
    const p = await createProduct('공용P', 2)
    const range = randomRange()
    const a = await reservationWithOption(p.parentId, range)
    const b = await createSession()
    const { data: d, error: de } = await admin.from('rental_reservations')
      .insert({ user_id: b.userId, product_id: p.parentId, status: 'draft' }).select('id').single()
    expect(de).toBeNull()
    const draftId = (d as { id: number }).id
    const { data, error } = await b.client.rpc('promote_draft_reservation', {
      p_reservation_id: draftId, p_start_date: range.start, p_end_date: range.end,
    })
    expect(error).toBeNull()
    const r = (data as Array<{ success: boolean; error_message: string | null }>)[0]
    expect(r.success, r.error_message ?? '').toBe(true)
    const unit = await mainUnitOf(draftId)
    expect(unit).not.toBe(a.assets[0])
  })

  it('O5: assign_bundle_assets — 결합 구성품 자동 배정도 옵션 배정 실물을 건너뛴다', async () => {
    const part = await createProduct('부품P', 2)
    const pkg = await createProduct('패키지', 1)
    const { error: le } = await admin.rpc('upsert_product_bundle_links', {
      p_product_id: pkg.parentId, p_bundle_links: [{ bundle_product_id: part.parentId, display_order: 0 }],
    })
    expect(le).toBeNull()
    const range = randomRange()
    const a = await reservationWithOption(part.parentId, range)
    const b = await createSession()
    const h = await hold(b.client, pkg.parentId, range.start, range.end)
    expect(h.success, h.error_message ?? '').toBe(true)
    const { data } = await admin.from('reservation_bundle_assets').select('asset_product_id').eq('reservation_id', h.reservation_id).single()
    expect((data as { asset_product_id: string }).asset_product_id).not.toBe(a.assets[0])
  })

  it('O6: 결합 구성품의 모든 재고가 옵션 배정으로 점유되면 패키지 예약은 구성품 부족으로 거절된다', async () => {
    const part = await createProduct('부품P', 1)
    const pkg = await createProduct('패키지', 1)
    await admin.rpc('upsert_product_bundle_links', {
      p_product_id: pkg.parentId, p_bundle_links: [{ bundle_product_id: part.parentId, display_order: 0 }],
    })
    const range = randomRange()
    await reservationWithOption(part.parentId, range)
    const b = await createSession()
    const h = await hold(b.client, pkg.parentId, range.start, range.end)
    expect(h.success).toBe(false)
    expect(h.error_message).toContain('구성품 재고')
  })

  it('O7: 본체 재배정 — 새 메인 재고가 다른 예약의 옵션·결합 배정과 겹치면 거부된다', async () => {
    const q = await createProduct('본체Q', 3)
    const range = randomRange()
    const b = await createSession()
    const h = await hold(b.client, q.parentId, range.start, range.end)
    expect(h.success).toBe(true)
    const current = await mainUnitOf(h.reservation_id)
    const others = q.childIds.filter(id => id !== current)
    // 다른 예약의 옵션 배정으로 점유된 실물
    const optHolder = await createSession()
    const mainX = await createProduct('메인X', 1)
    const hx = await hold(optHolder.client, mainX.parentId, range.start, range.end)
    const { data: ro } = await admin.from('reservation_options')
      .insert({ reservation_id: hx.reservation_id, option_product_id: q.parentId, option_name: '옵션Q', qty: 1, unit_price: 0 }).select('id').single()
    await admin.from('reservation_option_assets').insert({
      reservation_id: hx.reservation_id, reservation_option_id: (ro as { id: number }).id, option_product_id: q.parentId, asset_product_id: others[0],
    })
    // 다른 예약의 결합 배정으로 점유된 실물
    const bunHolder = await createSession()
    const mainY = await createProduct('메인Y', 1)
    const hy = await hold(bunHolder.client, mainY.parentId, range.start, range.end)
    await admin.from('reservation_bundle_assets').insert({
      reservation_id: hy.reservation_id, bundle_product_id: q.parentId, asset_product_id: others[1],
    })
    for (const busy of others) {
      const { data } = await admin.rpc('cms_reassign_reservation_product_code', { p_reservation_id: h.reservation_id, p_new_unit_id: busy })
      const r = (data as Array<{ success: boolean; error_message: string | null }>)[0]
      expect(r.success, busy).toBe(false)
      expect(r.error_message).toContain('이미 다른 예약')
    }
    expect(await mainUnitOf(h.reservation_id)).toBe(current)
  })

  it('O8: 본체 재배정 — 점유가 없으면 기존처럼 성공한다(회귀)', async () => {
    const q = await createProduct('본체Q', 2)
    const range = randomRange()
    const b = await createSession()
    const h = await hold(b.client, q.parentId, range.start, range.end)
    const current = await mainUnitOf(h.reservation_id)
    const target = q.childIds.find(id => id !== current) as string
    const { data } = await admin.rpc('cms_reassign_reservation_product_code', { p_reservation_id: h.reservation_id, p_new_unit_id: target })
    expect((data as Array<{ success: boolean }>)[0].success).toBe(true)
    expect(await mainUnitOf(h.reservation_id)).toBe(target)
  })

  it('O9: get_available_stock_counts — 옵션 배정으로 나간 실물은 가용재고에서 빠진다', async () => {
    const p = await createProduct('공용P', 3)
    const range = randomRange()
    const before = await admin.rpc('get_available_stock_counts', { p_product_ids: [p.parentId] })
    expect(((before.data ?? []) as Array<{ available_count: number }>)[0].available_count).toBe(3)
    await reservationWithOption(p.parentId, range)
    const after = await admin.rpc('get_available_stock_counts', { p_product_ids: [p.parentId] })
    expect(((after.data ?? []) as Array<{ available_count: number }>)[0].available_count).toBe(2)
  })

  it('O10: 옵션을 쓰지 않는 일반 상품의 예약·집계는 이전과 같다(회귀)', async () => {
    const p = await createProduct('일반', 2)
    const range = randomRange()
    const s = await createSession()
    const h = await hold(s.client, p.parentId, range.start, range.end)
    expect(h.success).toBe(true)
    expect(await mainUnitOf(h.reservation_id)).toBe(p.childIds[0]) // 가장 오래된 자식
    const c = await admin.rpc('get_available_stock_counts', { p_product_ids: [p.parentId] })
    expect(((c.data ?? []) as Array<{ available_count: number }>)[0].available_count).toBe(1)
  })
})
