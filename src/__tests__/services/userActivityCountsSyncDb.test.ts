import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { ensure24hPriceRule } from '../helpers/ensure24hPriceRule'

/**
 * 회원 활동 횟수(대여·연체·파손) 자동 동기화 — Migration 857·858, Stage 라이브
 *  A1 completed 예약이 생기면 대여 횟수 +1, 상태가 completed에서 빠지면 -1
 *  A2 연체료 기록 추가·삭제 → 연체 횟수 ±1
 *  A3 검수 이슈 추가·삭제 → 파손 횟수 ±1 (유형 구분 없음)
 *  A4 예약을 지우면(이슈 함께 삭제) 대여·파손 횟수가 모두 0으로 내려간다
 *  A5 저장 칸과 CMS 고객목록(get_customer_list) 값이 같다(857 ↔ 858 같은 기준)
 *  A6 새 함수는 일반 사용자 권한으로 실행할 수 없다
 *  A7 857·858 파일이 같은 기준 문구를 쓴다(이중 구현 동기화 가드)
 */
const isStage = PUBLIC_SUPABASE_URL.includes('ezyvffjvuwmtuhpxdjrw')
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
})

async function makeUser(): Promise<string> {
  const { data: u, error } = await admin.auth.admin.createUser({
    email: `tdd-activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    password: 'Test1234!',
    email_confirm: true,
  })
  if (error || !u.user) throw new Error(`user 생성 실패: ${error?.message}`)
  cleanups.push(() => admin.auth.admin.deleteUser(u.user.id).then(() => undefined).catch(() => undefined))
  return u.user.id
}

async function makeReservation(userId: string): Promise<number> {
  const { data: p } = await admin.from('products').select('id').is('parent_product_id', null).eq('is_active', true).limit(1).single()
  const productId = (p as { id: string }).id
  await ensure24hPriceRule(admin, productId)
  const day = Math.floor(Math.random() * 300)
  const start = new Date(Date.UTC(2099, 5, 1) + day * 86400000)
  const end = new Date(start.getTime() + 2 * 86400000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const { data, error } = await admin.from('rental_reservations').insert({
    user_id: userId, product_id: productId, start_date: fmt(start), end_date: fmt(end),
    status: 'hold', pickup_method: 'visit', return_method: 'visit',
  }).select('id').single()
  if (error || !data) throw new Error(`예약 생성 실패: ${error?.message}`)
  const id = (data as { id: number }).id
  cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', id) })
  return id
}

async function counts(userId: string): Promise<{ rental: number; late: number; damage: number }> {
  const { data, error } = await admin.from('user_profiles').select('rental_count, late_return_count, damage_count').eq('id', userId).single()
  if (error || !data) throw new Error(`카운터 조회 실패: ${error?.message}`)
  const r = data as { rental_count: number; late_return_count: number; damage_count: number }
  return { rental: r.rental_count, late: r.late_return_count, damage: r.damage_count }
}

describe.skipIf(!isStage)('회원 활동 횟수 자동 동기화 (Migration 857·858)', () => {
  it('A1 completed가 되면 대여 +1, completed에서 빠지면 -1', async () => {
    const userId = await makeUser()
    const resId = await makeReservation(userId)
    expect((await counts(userId)).rental).toBe(0)
    await admin.from('rental_reservations').update({ status: 'completed' }).eq('id', resId)
    expect((await counts(userId)).rental).toBe(1)
    await admin.from('rental_reservations').update({ status: 'cancelled' }).eq('id', resId)
    expect((await counts(userId)).rental).toBe(0)
  })

  it('A2 연체료 기록 추가·삭제 → 연체 횟수 ±1', async () => {
    const userId = await makeUser()
    const resId = await makeReservation(userId)
    const { error } = await admin.from('late_fees').insert({ reservation_id: resId, hours_late: 1, fee_amount: 1000 })
    expect(error).toBeNull()
    expect((await counts(userId)).late).toBe(1)
    await admin.from('late_fees').delete().eq('reservation_id', resId)
    expect((await counts(userId)).late).toBe(0)
  })

  it('A3 검수 이슈 2건 추가 → 파손 2, 1건 삭제 → 1 (유형 구분 없음)', async () => {
    const userId = await makeUser()
    const resId = await makeReservation(userId)
    const ins = await admin.from('reservation_inspection_issues').insert([
      { reservation_id: resId, issue_types: ['exterior_damage'], detail: 'tdd' },
      { reservation_id: resId, issue_types: ['missing_part'], detail: 'tdd' },
    ]).select('id')
    expect(ins.error).toBeNull()
    expect((await counts(userId)).damage).toBe(2)
    const firstId = (ins.data as Array<{ id: number }>)[0].id
    await admin.from('reservation_inspection_issues').delete().eq('id', firstId)
    expect((await counts(userId)).damage).toBe(1)
  })

  it('A4 예약을 지우면 대여·파손 횟수가 모두 0으로 내려간다', async () => {
    const userId = await makeUser()
    const resId = await makeReservation(userId)
    await admin.from('rental_reservations').update({ status: 'completed' }).eq('id', resId)
    await admin.from('reservation_inspection_issues').insert([
      { reservation_id: resId, issue_types: ['exterior_damage'], detail: 'tdd' },
      { reservation_id: resId, issue_types: ['mismatch'], detail: 'tdd' },
    ])
    expect(await counts(userId)).toEqual({ rental: 1, late: 0, damage: 2 })
    const del = await admin.from('rental_reservations').delete().eq('id', resId)
    expect(del.error).toBeNull()
    expect(await counts(userId)).toEqual({ rental: 0, late: 0, damage: 0 })
  })

  it('A5 저장 칸과 CMS 고객목록(get_customer_list) 값이 같다', async () => {
    const userId = await makeUser()
    const resId = await makeReservation(userId)
    await admin.from('rental_reservations').update({ status: 'completed' }).eq('id', resId)
    await admin.from('reservation_inspection_issues').insert({ reservation_id: resId, issue_types: ['exterior_damage'], detail: 'tdd' })
    const { data, error } = await admin.rpc('get_customer_list', { p_page: 1, p_limit: 1, p_user_id: userId })
    expect(error).toBeNull()
    const row = (data as Array<{ rental_count: number; late_return_count: number; damage_count: number }>)[0]
    const stored = await counts(userId)
    expect({ rental: row.rental_count, late: row.late_return_count, damage: row.damage_count }).toEqual(stored)
    expect(stored).toEqual({ rental: 1, late: 0, damage: 1 })
  })

  it('A6 일반 사용자(anon)는 새 함수를 호출할 수 없다', async () => {
    const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY
    if (!anonKey) return
    const anon = createClient(PUBLIC_SUPABASE_URL, anonKey)
    const r1 = await anon.rpc('get_customer_list', { p_page: 1, p_limit: 1 })
    expect(r1.error).not.toBeNull()
  })
})

describe('857·858 같은 기준 문구 (이중 구현 동기화 가드)', () => {
  const dir = 'supabase/migrations/'
  const m857 = readFileSync(`${dir}20261127110000_857_customer_list_live_counts.sql`, 'utf8')
  const m858 = readFileSync(`${dir}20261127120000_858_user_activity_counts_sync.sql`, 'utf8')

  it('A7 대여=completed, 연체=late_fees, 파손=reservation_inspection_issues 를 두 파일이 같게 센다', () => {
    for (const sql of [m857, m858]) {
      expect(sql).toContain("r.status = 'completed'")
      expect(sql).toContain('public.late_fees')
      expect(sql).toContain('public.reservation_inspection_issues')
      expect(sql).toContain('r.user_id')
    }
  })

  it('A8 859는 재계산 전에 회원 행을 잠가 동시 완료 경합을 막고, 기준 문구는 857·858과 같다', () => {
    const m859 = readFileSync(`${dir}20261127130000_859_activity_counts_row_lock.sql`, 'utf8')
    expect(m859).toMatch(/PERFORM 1 FROM public\.user_profiles up WHERE up\.id = p_user_id FOR UPDATE;/)
    expect(m859.indexOf('FOR UPDATE')).toBeLessThan(m859.indexOf("r.status = 'completed'"))
    expect(m859).toContain("r.status = 'completed'")
    expect(m859).toContain('public.late_fees')
    expect(m859).toContain('public.reservation_inspection_issues')
    expect(m859).toContain('REVOKE ALL ON FUNCTION private.refresh_user_activity_counts(uuid) FROM PUBLIC, anon, authenticated')
  })

  it('A7 858은 새 함수 3개를 anon·authenticated에서 회수한다', () => {
    expect(m858).toContain('REVOKE ALL ON FUNCTION private.refresh_user_activity_counts(uuid) FROM PUBLIC, anon, authenticated')
    expect(m858).toContain('REVOKE ALL ON FUNCTION private.trg_refresh_activity_counts_reservation() FROM PUBLIC, anon, authenticated')
    expect(m858).toContain('REVOKE ALL ON FUNCTION private.trg_refresh_activity_counts_child() FROM PUBLIC, anon, authenticated')
  })
})
