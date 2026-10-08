/**
 * lockerPasswordDiscard.test.ts — 무인보관함 비밀번호 자동 폐기 (Migration 673)
 * ① 예약이 취소·만료되면 비밀번호·안내 발송 기록이 비워진다  ② 전자계약 취소(sent_at 값→NULL)면 같은 주문의 예약 비밀번호가 비워진다
 * ③ 취소·만료 예약에는 저장할 수 없다  ④ 그 외 단계(hold·confirmed 등)는 입력 가능
 * Stage DB 라이브 테스트. fixture는 이 파일이 생성·정리한다.
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

async function setup(): Promise<{ userId: string; client: SupabaseClient; productId: string; reservationIds: number[] }> {
  const email = `tdd-locker-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`
  const { data: u, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !u.user) throw new Error(`user 생성 실패: ${error?.message}`)
  const userId = u.user.id
  await approveTestCustomer(admin, userId)
  const client = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
  await client.auth.signInWithPassword({ email, password: 'Test1234!' })
  const { data: p } = await admin.from('products').insert({ name: `[TDD-LPW] ${Date.now()}`, category: 'other', is_active: true }).select('id').single()
  const productId = (p as { id: string }).id
  const kids: string[] = []
  for (let i = 0; i < 2; i++) {
    const { data: c } = await admin.from('products').insert({ name: `[TDD-LPW] 자식${i}`, category: 'other', is_active: true, parent_product_id: productId }).select('id').single()
    kids.push((c as { id: string }).id)
  }
  // 자식이 생긴 뒤 부모 요금을 넣으면 동기화 트리거가 자식에게 복사한다
  await admin.from('price_rules').insert({ product_id: productId, duration_type: '24h', price: 10000, is_active: true })
  const reservationIds: number[] = []
  cleanups.push(async () => {
    await admin.from('contracts').delete().in('reservation_id', reservationIds)
    await admin.from('order_items').delete().in('reservation_id', reservationIds)
    await admin.from('rental_reservations').delete().in('product_id', [productId, ...kids])
    await admin.from('price_rules').delete().in('product_id', [productId, ...kids])
    await admin.from('products').delete().eq('parent_product_id', productId)
    await admin.from('products').delete().eq('id', productId)
    await admin.auth.admin.deleteUser(userId)
  })
  return { userId, client, productId, reservationIds }
}

let dayOffset = 0
async function hold(s: { client: SupabaseClient; productId: string; reservationIds: number[] }): Promise<number> {
  dayOffset += 3
  const d = new Date(Date.UTC(2041, 0, 1 + dayOffset + Math.floor(Math.random() * 300) * 3))
  const start = d.toISOString().slice(0, 10)
  const end = new Date(d.getTime() + 86400000).toISOString().slice(0, 10)
  const { data, error } = await s.client.rpc('create_hold_reservation', { p_product_id: s.productId, p_start_date: start, p_end_date: end })
  if (error) throw new Error(error.message)
  const row = (data as Array<{ success: boolean; reservation_id: number; error_message: string | null }>)[0]
  if (!row.success) throw new Error(row.error_message ?? 'hold 실패')
  s.reservationIds.push(row.reservation_id)
  return row.reservation_id
}

async function lockerOf(id: number): Promise<{ locker_password: string | null; locker_guide_sent_pickup_at: string | null }> {
  const { data } = await admin.from('rental_reservations').select('locker_password, locker_guide_sent_pickup_at').eq('id', id).single()
  return data as { locker_password: string | null; locker_guide_sent_pickup_at: string | null }
}

async function savePw(id: number, pw: string | null): Promise<void> {
  const { error } = await admin.from('rental_reservations').update({ locker_password: pw, locker_guide_sent_pickup_at: pw ? new Date().toISOString() : null }).eq('id', id)
  if (error) throw new Error(error.message)
}

describe('무인보관함 비밀번호 폐기 (Migration 673)', () => {
  it('D1: 취소로 바뀌면 비밀번호·안내 발송 기록이 비워진다', async () => {
    const s = await setup(); const id = await hold(s)
    await savePw(id, '12345678')
    expect((await lockerOf(id)).locker_password).toBe('12345678')
    await admin.from('rental_reservations').update({ status: 'cancelled' }).eq('id', id)
    const r = await lockerOf(id)
    expect(r.locker_password).toBeNull()
    expect(r.locker_guide_sent_pickup_at).toBeNull()
  })

  it('D2: 계약 미서명 만료(expired)로 바뀌어도 비워진다', async () => {
    const s = await setup(); const id = await hold(s)
    await savePw(id, '123456')
    await admin.from('rental_reservations').update({ status: 'expired' }).eq('id', id)
    expect((await lockerOf(id)).locker_password).toBeNull()
  })

  it('D3: 전자계약 취소(cancel_issued_contract)면 같은 주문의 형제 예약 비밀번호까지 비워진다', async () => {
    const s = await setup(); const a = await hold(s); const b = await hold(s)
    const { error: oErr } = await admin.rpc('create_reservation_order', { p_user_id: s.userId, p_reservation_ids: [a, b] })
    if (oErr) throw new Error(`주문 묶기 실패: ${oErr.message}`)
    const { data: c, error } = await admin.from('contracts').insert({ reservation_id: a, user_id: s.userId, contract_type: 'rental' }).select('id').single()
    if (error) throw new Error(`contracts 생성 실패: ${error.message}`)
    const contractId = (c as { id: string }).id
    const { error: sErr } = await admin.from('contract_signings').insert({ contract_id: contractId, user_id: s.userId, sent_at: new Date().toISOString() })
    if (sErr) throw new Error(`signings 생성 실패: ${sErr.message}`)
    await savePw(a, '5555'); await savePw(b, '66666666')
    const { error: rErr } = await admin.rpc('cancel_issued_contract', { p_contract_id: contractId })
    expect(rErr).toBeNull()
    expect((await lockerOf(a)).locker_password).toBeNull()
    expect((await lockerOf(b)).locker_password).toBeNull()
  })

  it('D4: 계약이 발송된 적 없거나 취소가 아닌 변경에서는 유지된다(hold·confirmed 입력 가능)', async () => {
    const s = await setup(); const id = await hold(s)
    await savePw(id, '1234567890')
    expect((await lockerOf(id)).locker_password).toBe('1234567890')
    await admin.from('rental_reservations').update({ status: 'confirmed' }).eq('id', id)
    expect((await lockerOf(id)).locker_password).toBe('1234567890')
  })

  it('D5: 저장 RPC는 취소·만료 예약을 거부한다(관리자 세션이 없으면 권한 거부이므로 SQL 정의로 확인)', async () => {
    const { readFileSync } = await import('node:fs')
    const sql = readFileSync('supabase/migrations/20261008050000_673_locker_password_discard.sql', 'utf-8')
    expect(sql).toContain("v_status IN ('cancelled', 'expired')")
    expect(sql).toContain('locker password not allowed for status')
  })
})
