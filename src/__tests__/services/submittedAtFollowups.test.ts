/* eslint-disable security/detect-non-literal-fs-filename -- 테스트가 소스 파일을 스캔하는 용도(고정된 프로젝트 경로, 사용자 입력 없음) */
/**
 * submittedAtFollowups.test.ts — sp3-qa MINOR-3·4 보완 (Migration 685, 2026-10-09)
 *  · MINOR-4: get_rental_list 정렬에 보조 키(예약 id)를 둬서 신청 시각이 같은 예약들의 순서·페이지 경계를 결정적으로 만든다
 *  · MINOR-3: CMS "+추가"(cms_add_reservation_product_unit)로 만든 예약이 원본 예약의 submitted_at을 물려받는다(주문에 합류한 상품은 같은 신청)
 * Stage DB 라이브 테스트 — fixture는 이 파일이 만들고 정리한다.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'
import { approveTestCustomer } from '../helpers/approveTestCustomer'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanups.length) { const fn = cleanups.pop(); if (fn) await fn().catch(() => undefined) }
}, 60_000)

async function fixture(kidCount: number): Promise<{ userId: string; client: SupabaseClient; productId: string; ids: number[] }> {
  const email = `tdd-sbf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`
  const { data: u, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !u.user) throw new Error(`user 생성 실패: ${error?.message}`)
  const userId = u.user.id
  await approveTestCustomer(admin, userId)
  const client = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
  await client.auth.signInWithPassword({ email, password: 'Test1234!' })
  const { data: p } = await admin.from('products').insert({ name: `[TDD-SBF] ${Date.now()}`, category: 'other', is_active: true }).select('id').single()
  const productId = (p as { id: string }).id
  const kids: string[] = []
  for (let i = 0; i < kidCount; i++) {
    const { data: c } = await admin.from('products').insert({ name: '[TDD-SBF] 자식', category: 'other', is_active: true, parent_product_id: productId }).select('id').single()
    kids.push((c as { id: string }).id)
  }
  await admin.from('price_rules').insert({ product_id: productId, duration_type: '24h', price: 10000, is_active: true })
  const ids: number[] = []
  cleanups.push(async () => {
    const { data: extra } = await admin.from('rental_reservations').select('id').in('product_id', kids)
    const all = [...new Set([...ids, ...((extra ?? []) as Array<{ id: number }>).map(r => r.id)])]
    await admin.from('order_items').delete().in('reservation_id', all)
    await admin.from('rental_reservations').delete().in('id', all)
    await admin.from('price_rules').delete().in('product_id', [productId, ...kids])
    await admin.from('products').delete().eq('parent_product_id', productId)
    await admin.from('products').delete().eq('id', productId)
    await admin.auth.admin.deleteUser(userId)
  })
  return { userId, client, productId, ids }
}

let seq = 0
async function hold(f: { client: SupabaseClient; productId: string; ids: number[] }, start?: string): Promise<number> {
  seq += 3
  const d = start ? new Date(start + 'T00:00:00Z') : new Date(Date.UTC(2046, 0, 1 + seq + Math.floor(Math.random() * 300) * 3))
  const s = d.toISOString().slice(0, 10)
  const e = new Date(d.getTime() + 86400000).toISOString().slice(0, 10)
  const { data, error } = await f.client.rpc('create_hold_reservation', { p_product_id: f.productId, p_start_date: s, p_end_date: e })
  if (error) throw new Error(error.message)
  const row = (data as Array<{ success: boolean; reservation_id: number; error_message: string | null }>)[0]
  if (!row.success) throw new Error(row.error_message ?? 'hold 실패')
  f.ids.push(row.reservation_id)
  return row.reservation_id
}

describe('get_rental_list 정렬 보조 키 (MINOR-4)', () => {
  it('F1: 신청 시각이 같은 예약들은 예약 id 내림차순으로 결정적으로 나온다(단건 모드)', async () => {
    const f = await fixture(3)
    const a = await hold(f); const b = await hold(f); const c = await hold(f)
    const same = new Date(Date.now() + 3600_000).toISOString() // 다른 모든 예약보다 최신 → 목록 맨 앞에 몰려 나온다
    await admin.from('rental_reservations').update({ submitted_at: same }).in('id', [a, b, c])
    const { data, error } = await admin.rpc('get_rental_list', { p_per_page: 50, p_page: 1, p_group_by_order: false })
    if (error) throw new Error(error.message)
    const order = ((data ?? []) as Array<{ reservation_id: number }>).map(r => r.reservation_id).filter(id => [a, b, c].includes(id))
    expect(order).toEqual([c, b, a].sort((x, y) => y - x))
  })

  it('F2: 마이그레이션이 단건·묶음 모드 정렬 모두에 보조 키를 둔다', () => {
    const sql = readFileSync('supabase/migrations/20261009030000_685_submitted_at_followups.sql', 'utf-8')
    expect(sql).toContain('ORDER BY rr.submitted_at DESC, rr.id DESC')
    expect(sql).toContain('ORDER BY g.b_created_at DESC, g.b_rid DESC')
  })
})

describe('"+추가" 예약의 신청 시각 (MINOR-3)', () => {
  it('F3: cms_add_reservation_product_unit이 만든 예약은 원본 예약의 submitted_at을 물려받는다', async () => {
    const f = await fixture(2)
    const origin = await hold(f, '2046-06-10')
    const { error: oErr } = await admin.rpc('create_reservation_order', { p_user_id: f.userId, p_reservation_ids: [origin] })
    if (oErr) throw new Error(`주문 생성 실패: ${oErr.message}`)
    const past = new Date(Date.now() - 5 * 86400000).toISOString()
    await admin.from('rental_reservations').update({ submitted_at: past }).eq('id', origin)
    const { data, error } = await admin.rpc('cms_add_reservation_product_unit', { p_reservation_id: origin, p_product_id: f.productId })
    if (error) throw new Error(error.message)
    const res = (data as Array<{ success: boolean; new_reservation_id: number | null; error_message: string | null }>)[0]
    expect(res.success, res.error_message ?? '').toBe(true)
    const newId = res.new_reservation_id as number
    f.ids.push(newId)
    const { data: row } = await admin.from('rental_reservations').select('submitted_at, created_at').eq('id', newId).single()
    const t = row as { submitted_at: string; created_at: string }
    expect(new Date(t.submitted_at).getTime()).toBe(new Date(past).getTime())
    expect(new Date(t.created_at).getTime()).toBeGreaterThan(new Date(past).getTime() + 86400000)
  })
})
