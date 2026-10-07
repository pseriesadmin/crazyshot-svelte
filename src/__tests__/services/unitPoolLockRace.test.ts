/**
 * unitPoolLockRace.test.ts — sp3-qa 3차 MINOR-1: 같은 실물을 두고 메인·결합·옵션 배정이 동시에 몰릴 때 이중 점유 방지 (Migration 660)
 *
 * 원인: 각 배정 경로는 후보 상품 행을 FOR UPDATE SKIP LOCKED로 잠그지만, 한쪽이 이미 커밋을 끝낸 뒤 늦게 도착한 다른 쪽은
 *       "자기 문장 시작 시점의 스냅샷"으로 점유 여부를 판정해 방금 커밋된 상대 배정을 못 볼 수 있다(예: bundleInventoryHold EC-7이 부하에서 가끔 실패).
 * 수정: 실물 풀(부모 상품) 단위 advisory lock(private.lock_unit_pools)을 배정 경로 시작에서 정렬된 순서로 잡아 같은 풀의 배정을 직렬화한다.
 *
 * 부하 테스트라 확률적이다 — 위반이 "0건"인지를 라운드마다 확인한다(수정 전에는 가끔 위반이 관측될 수 있음).
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 테스트. fixture는 전부 이 파일이 생성·정리한다.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'
import { approveTestCustomer } from '../helpers/approveTestCustomer'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []
// 10라운드 분량의 fixture(상품·예약·사용자 수십 개)를 지우므로 기본 hookTimeout(10초)으로는 부족하다
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
}, 240_000)

async function createSession(): Promise<{ client: SupabaseClient; userId: string }> {
  const email = `tdd-pool-lock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
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
  const base = new Date(Date.UTC(2042, 0, 1))
  base.setUTCDate(base.getUTCDate() + Math.floor(Math.random() * 1500))
  const start = fmt(base)
  return { start, end: addDays(start, 1) }
}

async function createProduct(label: string, childCount: number): Promise<{ parentId: string; childIds: string[] }> {
  const { data: parent, error } = await admin
    .from('products')
    .insert({ name: `[TDD-UPL] ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, category: 'other', is_active: true })
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
      .insert({ name: `[TDD-UPL] ${label} 자식${i}`, category: 'other', is_active: true, parent_product_id: parentId })
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

const ROUNDS = 10

/** 단 하나뿐인 실물(자식 1개) c를 두고 서로 다른 두 경로가 같은 순간 몰릴 때, c가 두 역할을 동시에 맡은 라운드 수 */
async function countDoubleOccupancy(
  mode: 'main-vs-option' | 'bundle-vs-option' | 'main-vs-bundle',
): Promise<{ violations: number; rounds: number }> {
  const a = await createSession()
  const b = await createSession()
  let violations = 0
  for (let i = 0; i < ROUNDS; i++) {
    const range = randomRange()
    const pool = await createProduct('풀P', 1)
    const unit = pool.childIds[0]

    if (mode === 'main-vs-option') {
      const mainB = await createProduct('메인B', 1)
      const hb = await hold(b.client, mainB.parentId, range.start, range.end)
      expect(hb.success).toBe(true)
      await Promise.all([
        hold(a.client, pool.parentId, range.start, range.end),
        b.client.rpc('set_reservation_options', {
          p_reservation_id: hb.reservation_id,
          p_options: [{ option_product_id: pool.parentId, option_name: '옵션P', qty: 1, unit_price: 0 }],
        }),
      ])
      const { data: mainRows } = await admin.from('rental_reservations').select('id').eq('product_id', unit).in('status', ['hold', 'confirmed'])
      const { data: optRows } = await admin.from('reservation_option_assets').select('id').eq('asset_product_id', unit)
      if ((mainRows ?? []).length > 0 && (optRows ?? []).length > 0) violations++
    } else if (mode === 'bundle-vs-option') {
      const pkg = await createProduct('패키지', 1)
      await admin.rpc('upsert_product_bundle_links', {
        p_product_id: pkg.parentId, p_bundle_links: [{ bundle_product_id: pool.parentId, display_order: 0 }],
      })
      const mainB = await createProduct('메인B', 1)
      const hb = await hold(b.client, mainB.parentId, range.start, range.end)
      expect(hb.success).toBe(true)
      await Promise.all([
        hold(a.client, pkg.parentId, range.start, range.end),
        b.client.rpc('set_reservation_options', {
          p_reservation_id: hb.reservation_id,
          p_options: [{ option_product_id: pool.parentId, option_name: '옵션P', qty: 1, unit_price: 0 }],
        }),
      ])
      const { data: bunRows } = await admin.from('reservation_bundle_assets').select('id').eq('asset_product_id', unit)
      const { data: optRows } = await admin.from('reservation_option_assets').select('id').eq('asset_product_id', unit)
      if ((bunRows ?? []).length > 0 && (optRows ?? []).length > 0) violations++
    } else {
      const pkg = await createProduct('패키지', 1)
      await admin.rpc('upsert_product_bundle_links', {
        p_product_id: pkg.parentId, p_bundle_links: [{ bundle_product_id: pool.parentId, display_order: 0 }],
      })
      await Promise.all([
        hold(a.client, pkg.parentId, range.start, range.end),
        hold(b.client, pool.parentId, range.start, range.end),
      ])
      const { data: bunRows } = await admin.from('reservation_bundle_assets').select('id').eq('asset_product_id', unit)
      const { data: mainRows } = await admin.from('rental_reservations').select('id').eq('product_id', unit).in('status', ['hold', 'confirmed'])
      if ((bunRows ?? []).length > 0 && (mainRows ?? []).length > 0) violations++
    }
  }
  return { violations, rounds: ROUNDS }
}

describe('[부하] 같은 실물을 두고 동시에 몰리는 배정 — 이중 점유 0건 (Migration 660)', () => {
  it('L1: 메인 예약 신청 ↔ 옵션 저장이 같은 순간 몰려도 한 실물이 두 역할을 맡지 않는다', async () => {
    const r = await countDoubleOccupancy('main-vs-option')
    expect(r.violations, `${r.rounds}라운드 중 위반`).toBe(0)
  }, 180_000)

  it('L2: 패키지 예약(결합 구성품 배정) ↔ 옵션 저장이 같은 순간 몰려도 한 실물이 두 역할을 맡지 않는다', async () => {
    const r = await countDoubleOccupancy('bundle-vs-option')
    expect(r.violations, `${r.rounds}라운드 중 위반`).toBe(0)
  }, 180_000)

  it('L3: 패키지 예약(결합 구성품) ↔ 결합 상품 단독 메인 예약이 같은 순간 몰려도 한 실물이 두 역할을 맡지 않는다', async () => {
    const r = await countDoubleOccupancy('main-vs-bundle')
    expect(r.violations, `${r.rounds}라운드 중 위반`).toBe(0)
  }, 180_000)
})

describe('[구조] 풀 잠금이 모든 배정 경로에 걸려 있다 (Migration 660)', () => {
  const readSql = (): string => readFileSync(join(process.cwd(), 'supabase/migrations/20261006110000_660_unit_pool_advisory_lock.sql'), 'utf-8')

  it('잠금 함수는 정렬·중복 제거 순서로 잡고 대기 상한을 둔다(교착·무한 대기 방지)', () => {
    const sql = readSql()
    expect(sql).toContain('CREATE OR REPLACE FUNCTION private.lock_unit_pools')
    expect(sql).toMatch(/SELECT DISTINCT u FROM unnest\(p_pools\)[\s\S]{0,80}ORDER BY u/)
    expect(sql).toContain('pg_try_advisory_xact_lock')
    expect(sql).toMatch(/v_try >= \d+/)
  })

  it('6개 배정·재배정 경로에 잠금 호출을 치환 방식으로 추가한다(일치 1회·멱등)', () => {
    const sql = readSql()
    for (const fn of [
      'create_hold_reservation', 'promote_draft_reservation', 'cms_reassign_reservation_product_code',
      'cms_reassign_bundle_asset', 'cms_reassign_option_asset', 'assign_option_assets',
    ]) {
      expect(sql, fn).toContain(fn)
    }
    expect(sql).toContain("position('lock_unit_pools' in v_def) > 0")
    expect(sql).toMatch(/v_cnt <> 1/)
  })

  it('잠금 대상은 항상 부모(풀) 단위이며 서버 전용(REVOKE)이다', () => {
    const sql = readSql()
    expect(sql).toContain('REVOKE ALL ON FUNCTION private.lock_unit_pools(uuid[]) FROM PUBLIC, anon, authenticated')
  })
})
