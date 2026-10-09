import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { ensure24hPriceRule } from '../helpers/ensure24hPriceRule'
import { attachCancelPending } from '$lib/server/attachCancelPending'

/**
 * 고객 취소 요청 표식(Migration 687) — Stage 라이브
 *  R1 hold(신청대기)에는 표식이 붙지 않는다(요청 대상은 계약완료만)
 *  R2 confirmed에는 표식 1회 기록, 재호출은 멱등(0건)
 *  R3 anon·authenticated는 RPC 호출 불가(service_role 전용)
 *  R4 표식 있는 예약만 "취소대기"로 판정되고, cancelled가 되면 대기가 자동 종료된다
 */
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
})

async function makeReservation(status: 'hold' | 'confirmed'): Promise<number> {
  const { data: p } = await admin.from('products').select('id').is('parent_product_id', null).eq('is_active', true).limit(1).single()
  const productId = (p as { id: string }).id
  await ensure24hPriceRule(admin, productId)
  const { data: u, error: ue } = await admin.auth.admin.createUser({
    email: `tdd-cancelreq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    password: 'Test1234!',
    email_confirm: true,
  })
  if (ue || !u.user) throw new Error(`user 생성 실패: ${ue?.message}`)
  cleanups.push(() => admin.auth.admin.deleteUser(u.user.id).then(() => undefined).catch(() => undefined))
  const day = Math.floor(Math.random() * 300)
  const start = new Date(Date.UTC(2099, 5, 1) + day * 86400000)
  const end = new Date(start.getTime() + 2 * 86400000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const { data, error } = await admin.from('rental_reservations').insert({
    user_id: u.user.id, product_id: productId, start_date: fmt(start), end_date: fmt(end),
    status: 'hold', pickup_method: 'visit', return_method: 'visit',
  }).select('id').single()
  if (error || !data) throw new Error(`예약 생성 실패: ${error?.message}`)
  const id = (data as { id: number }).id
  cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', id) })
  if (status === 'confirmed') {
    const { error: e2 } = await admin.from('rental_reservations').update({ status: 'confirmed' }).eq('id', id)
    if (e2) throw new Error(`confirmed 전환 실패: ${e2.message}`)
  }
  return id
}

describe('request_customer_cancel (Migration 687)', () => {
  it('R1 hold에는 표식이 붙지 않는다', async () => {
    const id = await makeReservation('hold')
    const { data, error } = await admin.rpc('request_customer_cancel', { p_reservation_ids: [id] })
    expect(error).toBeNull()
    expect(data).toBe(0)
  })

  it('R2 confirmed에는 1회 기록, 재호출은 멱등', async () => {
    const id = await makeReservation('confirmed')
    const first = await admin.rpc('request_customer_cancel', { p_reservation_ids: [id] })
    expect(first.data).toBe(1)
    const second = await admin.rpc('request_customer_cancel', { p_reservation_ids: [id] })
    expect(second.data).toBe(0)
    const { data } = await admin.from('rental_reservations').select('cancel_requested_at').eq('id', id).single()
    expect((data as { cancel_requested_at: string | null }).cancel_requested_at).not.toBeNull()
  })

  it('R3 anon은 RPC를 호출할 수 없다', async () => {
    const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY
    if (!anonKey) return
    const anon = createClient(PUBLIC_SUPABASE_URL, anonKey)
    const { error } = await anon.rpc('request_customer_cancel', { p_reservation_ids: [1] })
    expect(error).not.toBeNull()
  })

  it('R4 표식 있는 예약만 취소대기, cancelled가 되면 대기 종료', async () => {
    const pendingId = await makeReservation('confirmed')
    const plainId = await makeReservation('confirmed')
    await admin.rpc('request_customer_cancel', { p_reservation_ids: [pendingId] })

    const rows = [{ reservation_id: pendingId }, { reservation_id: plainId }] as Array<{ reservation_id: number; cancel_pending?: boolean }>
    await attachCancelPending(admin, rows)
    expect(rows[0].cancel_pending).toBe(true)
    expect(rows[1].cancel_pending).toBeUndefined()

    await admin.rpc('update_reservation_status', { p_reservation_id: pendingId, p_new_status: 'cancelled' })
    const after = [{ reservation_id: pendingId }] as Array<{ reservation_id: number; cancel_pending?: boolean }>
    await attachCancelPending(admin, after)
    expect(after[0].cancel_pending).toBeUndefined()
  })
})
