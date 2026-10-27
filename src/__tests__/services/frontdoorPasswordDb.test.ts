/**
 * Stage DB 라이브 시험 — set_reservation_frontdoor_password (Migration #774, 2026-10-27)
 *
 * 수령(배송) 공동현관 출입번호 전용 칸. 두발히어로 frontdoorPassword(운송장 미인쇄·라이더앱 전용)로 전달된다.
 *
 * FD-1 고객 본인 예약에 저장되고 앞뒤 공백은 지워진다
 * FD-2 빈 값·공백은 NULL 로 비운다
 * FD-3 다른 고객은 남의 예약에 저장할 수 없다(조용히 무시)
 * FD-4 50자를 넘기면 오류(frontdoor_password_too_long)이고 값이 바뀌지 않는다
 * FD-5 로그인하지 않은 호출(anon)은 권한 오류
 * FD-7 운송장(접수번호)이 생긴 뒤에는 바꾸지 않는다(CMS 값과 두발히어로 전달 값이 어긋나는 것 방지)
 * FD-8 제어문자(개행·탭)·방향제어·제로폭 문자는 제거한다
 * FD-6 허용 목록(draft·hold·pending·confirmed) 밖 상태(취소·출고 후·파손 등)에는 저장하지 않는다
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'
import { approveTestCustomer } from '../helpers/approveTestCustomer'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const FIXTURE_PARENT_ID = '955238da-5440-47b1-906d-4865232f3a6c'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

async function createSession(): Promise<{ client: SupabaseClient; userId: string }> {
  const email = `tdd-frontdoor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const password = 'Test1234!'
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`)
  const userId = data.user.id
  await approveTestCustomer(admin, userId)
  const asUser = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
  const { error: signInErr } = await asUser.auth.signInWithPassword({ email, password })
  if (signInErr) throw new Error(`로그인 실패: ${signInErr.message}`)
  cleanups.push(async () => { await admin.auth.admin.deleteUser(userId) })
  return { client: asUser, userId }
}

function farRange(): { start: string; end: string } {
  const base = new Date(Date.UTC(2031, 0, 1))
  base.setUTCDate(base.getUTCDate() + Math.floor(Math.random() * 300))
  const start = base.toISOString().slice(0, 10)
  return { start, end: new Date(base.getTime() + 2 * 86400000).toISOString().slice(0, 10) }
}

async function createHold(client: SupabaseClient): Promise<number> {
  const { start, end } = farRange()
  const { data, error } = await client.rpc('create_hold_reservation', { p_product_id: FIXTURE_PARENT_ID, p_start_date: start, p_end_date: end })
  const row = Array.isArray(data) ? data[0] : data
  if (error || !row?.success) throw new Error(`create_hold_reservation 실패: ${error?.message ?? row?.error_message}`)
  return row.reservation_id as number
}

async function stored(id: number): Promise<string | null> {
  const { data } = await admin.from('rental_reservations').select('pickup_frontdoor_password').eq('id', id).maybeSingle()
  return (data as { pickup_frontdoor_password: string | null } | null)?.pickup_frontdoor_password ?? null
}

describe('set_reservation_frontdoor_password (Migration #774, Stage 라이브)', () => {
  it('FD-1·2: 본인 예약에 저장(공백 제거)하고 빈 값은 NULL 로 비운다', async () => {
    const { client } = await createSession()
    const id = await createHold(client)
    const r1 = await client.rpc('set_reservation_frontdoor_password', { p_reservation_id: id, p_password: '  #1234*  ' })
    expect(r1.error).toBeNull()
    expect(await stored(id)).toBe('#1234*')
    const r2 = await client.rpc('set_reservation_frontdoor_password', { p_reservation_id: id, p_password: '   ' })
    expect(r2.error).toBeNull()
    expect(await stored(id)).toBeNull()
  }, 60000)

  it('FD-3: 다른 고객은 남의 예약에 저장할 수 없다', async () => {
    const owner = await createSession()
    const other = await createSession()
    const id = await createHold(owner.client)
    await owner.client.rpc('set_reservation_frontdoor_password', { p_reservation_id: id, p_password: '1111' })
    const r = await other.client.rpc('set_reservation_frontdoor_password', { p_reservation_id: id, p_password: '9999' })
    expect(r.error).toBeNull() // 조용히 무시(기존 set_reservation_shipment_method 와 같은 원칙)
    expect(await stored(id)).toBe('1111')
  }, 90000)

  it('FD-4: 50자를 넘기면 오류이고 값이 바뀌지 않는다', async () => {
    const { client } = await createSession()
    const id = await createHold(client)
    await client.rpc('set_reservation_frontdoor_password', { p_reservation_id: id, p_password: '1234' })
    const r = await client.rpc('set_reservation_frontdoor_password', { p_reservation_id: id, p_password: 'x'.repeat(51) })
    expect(r.error?.message ?? '').toContain('frontdoor_password_too_long')
    expect(await stored(id)).toBe('1234')
    const ok = await client.rpc('set_reservation_frontdoor_password', { p_reservation_id: id, p_password: 'y'.repeat(50) })
    expect(ok.error).toBeNull()
    expect((await stored(id))?.length).toBe(50)
  }, 60000)

  it('FD-5: 로그인하지 않은 호출은 권한 오류', async () => {
    const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    const r = await anon.rpc('set_reservation_frontdoor_password', { p_reservation_id: 1, p_password: '1234' })
    expect(r.error).not.toBeNull()
  }, 30000)

  it('FD-6: 허용 목록 밖 상태(취소·출고 후·파손 등)에는 저장하지 않는다', async () => {
    const { client } = await createSession()
    const id = await createHold(client)
    await client.rpc('set_reservation_frontdoor_password', { p_reservation_id: id, p_password: '1234' })
    for (const status of ['cancelled', 'shipped', 'in_use', 'return_requested', 'returned', 'completed', 'damage_claimed', 'expired']) {
      await admin.from('rental_reservations').update({ status }).eq('id', id)
      const r = await client.rpc('set_reservation_frontdoor_password', { p_reservation_id: id, p_password: '9999' })
      expect(r.error, status).toBeNull()
      expect(await stored(id), status).toBe('1234')
    }
    // 허용 상태(confirmed)로 돌리면 다시 저장된다
    await admin.from('rental_reservations').update({ status: 'confirmed' }).eq('id', id)
    await client.rpc('set_reservation_frontdoor_password', { p_reservation_id: id, p_password: '5555' })
    expect(await stored(id)).toBe('5555')
  }, 90000)

  it('FD-7: 운송장(접수번호)이 생긴 뒤에는 바꾸지 않는다', async () => {
    const { client } = await createSession()
    const id = await createHold(client)
    await client.rpc('set_reservation_frontdoor_password', { p_reservation_id: id, p_password: '1234' })
    await admin.from('rental_reservations').update({ tracking_number: 'TDD-FD-TRACK' }).eq('id', id)
    const r = await client.rpc('set_reservation_frontdoor_password', { p_reservation_id: id, p_password: '9999' })
    expect(r.error).toBeNull()
    expect(await stored(id)).toBe('1234')
    await admin.from('rental_reservations').update({ tracking_number: null }).eq('id', id)
    await client.rpc('set_reservation_frontdoor_password', { p_reservation_id: id, p_password: '9999' })
    expect(await stored(id)).toBe('9999')
  }, 60000)

  it('FD-8: 제어문자·방향제어·제로폭 문자는 제거한다(개행·탭·U+202E·U+200B)', async () => {
    const { client } = await createSession()
    const id = await createHold(client)
    const dirty = '#12\n34\t*\u202E\u200B\u0007 '
    const r = await client.rpc('set_reservation_frontdoor_password', { p_reservation_id: id, p_password: dirty })
    expect(r.error).toBeNull()
    expect(await stored(id)).toBe('#1234*')
    // 정리 후 비면 NULL
    await client.rpc('set_reservation_frontdoor_password', { p_reservation_id: id, p_password: '\n\t\u202E' })
    expect(await stored(id)).toBeNull()
  }, 60000)
})
