/**
 * rentalListSubmittedAt.test.ts — CMS 예약목록 "신청일(시)" = 예약의 submitted_at (Migration 679→684, 2026-10-09)
 * 예약 행(rental_reservations.created_at)은 장바구니에 담은 시각에 만들어진다. 신청(체크아웃 제출) 시각은 submitted_at 컬럼(Migration 684)이 정본이다.
 * 목록 함수는 created_at 필드에 submitted_at을 담아 돌려준다(필드명 호환 유지). 정렬도 같은 값 기준.
 * Stage DB 라이브 테스트 — fixture는 이 파일이 만들고 정리한다.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'
import { approveTestCustomer } from '../helpers/approveTestCustomer'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanups.length) { const fn = cleanups.pop(); if (fn) await fn().catch(() => undefined) }
}, 60_000)

interface ListRow { reservation_id: number; created_at: string }

async function fixture(): Promise<{ userId: string; client: SupabaseClient; productId: string; ids: number[] }> {
  const email = `tdd-sub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`
  const { data: u, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !u.user) throw new Error(`user 생성 실패: ${error?.message}`)
  const userId = u.user.id
  await approveTestCustomer(admin, userId)
  const client = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
  await client.auth.signInWithPassword({ email, password: 'Test1234!' })
  const { data: p } = await admin.from('products').insert({ name: `[TDD-SUB] ${Date.now()}`, category: 'other', is_active: true }).select('id').single()
  const productId = (p as { id: string }).id
  const kids: string[] = []
  for (let i = 0; i < 2; i++) {
    const { data: c } = await admin.from('products').insert({ name: '[TDD-SUB] 자식', category: 'other', is_active: true, parent_product_id: productId }).select('id').single()
    kids.push((c as { id: string }).id)
  }
  await admin.from('price_rules').insert({ product_id: productId, duration_type: '24h', price: 10000, is_active: true })
  const ids: number[] = []
  cleanups.push(async () => {
    await admin.from('order_items').delete().in('reservation_id', ids)
    await admin.from('rental_reservations').delete().in('id', ids)
    await admin.from('price_rules').delete().in('product_id', [productId, ...kids])
    await admin.from('products').delete().eq('parent_product_id', productId)
    await admin.from('products').delete().eq('id', productId)
    await admin.auth.admin.deleteUser(userId)
  })
  return { userId, client, productId, ids }
}

let seq = 0
async function hold(f: { client: SupabaseClient; productId: string; ids: number[] }): Promise<number> {
  seq += 3
  const d = new Date(Date.UTC(2044, 0, 1 + seq + Math.floor(Math.random() * 300) * 3))
  const start = d.toISOString().slice(0, 10)
  const end = new Date(d.getTime() + 86400000).toISOString().slice(0, 10)
  const { data, error } = await f.client.rpc('create_hold_reservation', { p_product_id: f.productId, p_start_date: start, p_end_date: end })
  if (error) throw new Error(error.message)
  const row = (data as Array<{ success: boolean; reservation_id: number; error_message: string | null }>)[0]
  if (!row.success) throw new Error(row.error_message ?? 'hold 실패')
  f.ids.push(row.reservation_id)
  return row.reservation_id
}

async function listRow(id: number, group: boolean): Promise<ListRow> {
  const { data, error } = await admin.rpc('get_rental_list', { p_reservation_id: id, p_per_page: 5, p_group_by_order: group })
  if (error) throw new Error(error.message)
  const r = ((data ?? []) as ListRow[]).find(x => x.reservation_id === id)
  if (!r) throw new Error(`목록에 예약 ${id} 없음`)
  return r
}

describe('CMS 목록 신청일 = submitted_at (Migration 684)', () => {
  it('S1: 장바구니에 담은 시각(created_at)이 오래돼도 목록 신청일은 submitted_at을 돌려준다(묶음·단건 모드 모두)', async () => {
    const f = await fixture()
    const id = await hold(f)
    const old = new Date(Date.now() - 3 * 86400000).toISOString()
    await admin.from('rental_reservations').update({ created_at: old }).eq('id', id)
    const { data } = await admin.from('rental_reservations').select('submitted_at').eq('id', id).single()
    const submitted = (data as { submitted_at: string }).submitted_at
    for (const group of [false, true]) {
      const r = await listRow(id, group)
      expect(new Date(r.created_at).getTime(), `group=${group}`).toBe(new Date(submitted).getTime())
      expect(new Date(r.created_at).getTime()).toBeGreaterThan(new Date(old).getTime() + 86400000)
    }
  })

  it('S2: submitted_at을 직접 지정하면 그 값이 그대로 신청일로 나온다', async () => {
    const f = await fixture()
    const id = await hold(f)
    const x = new Date(Date.now() - 2 * 86400000).toISOString()
    await admin.from('rental_reservations').update({ submitted_at: x }).eq('id', id)
    for (const group of [false, true]) {
      const r = await listRow(id, group)
      expect(new Date(r.created_at).getTime(), `group=${group}`).toBe(new Date(x).getTime())
    }
  })
})
