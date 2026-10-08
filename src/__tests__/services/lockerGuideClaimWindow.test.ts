/**
 * lockerGuideClaimWindow.test.ts — 무인보관함 안내 발송 대상 선정(claim_reservations_due_for_locker_guide) (Migration 674)
 * 정책: 방문·퀵서비스 예약의 수령(반납) 시각 1시간 이내에 비밀번호가 있으면 낮·밤 구분 없이 발송 대상이다(영업외시간 제한 없음).
 * 상태: 수령=계약완료·반출중 / 반납=대여중·반납접수. 기간 밖·비밀번호 없음·이미 발송됨·대상 방식 아님은 제외.
 * Stage DB 라이브 테스트 — fixture는 이 파일이 만들고 정리한다. claim은 발송 표시만 남기고 문자·푸시는 보내지 않는다.
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

/** 지금으로부터 offsetMin분 뒤의 KST 날짜(YYYY-MM-DD)와 시각(HH:MM) */
function kstAfter(offsetMin: number): { date: string; time: string } {
  const t = new Date(Date.now() + offsetMin * 60_000)
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(t)
  const g = (k: string): string => parts.find(p => p.type === k)?.value ?? ''
  const hh = g('hour') === '24' ? '00' : g('hour')
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${hh}:${g('minute')}` }
}

async function newReservation(): Promise<number> {
  const email = `tdd-lg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`
  const { data: u, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !u.user) throw new Error(`user 생성 실패: ${error?.message}`)
  const userId = u.user.id
  await approveTestCustomer(admin, userId)
  const client: SupabaseClient = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
  await client.auth.signInWithPassword({ email, password: 'Test1234!' })
  const { data: p } = await admin.from('products').insert({ name: `[TDD-LG] ${Date.now()}`, category: 'other', is_active: true }).select('id').single()
  const productId = (p as { id: string }).id
  const { data: c } = await admin.from('products').insert({ name: '[TDD-LG] 자식', category: 'other', is_active: true, parent_product_id: productId }).select('id').single()
  const childId = (c as { id: string }).id
  const d = new Date(Date.UTC(2043, 0, 1 + Math.floor(Math.random() * 300) * 3))
  const start = d.toISOString().slice(0, 10)
  const end = new Date(d.getTime() + 86400000).toISOString().slice(0, 10)
  const { data, error: hErr } = await client.rpc('create_hold_reservation', { p_product_id: productId, p_start_date: start, p_end_date: end })
  if (hErr) throw new Error(hErr.message)
  const row = (data as Array<{ success: boolean; reservation_id: number; error_message: string | null }>)[0]
  if (!row.success) throw new Error(row.error_message ?? 'hold 실패')
  cleanups.push(async () => {
    await admin.from('rental_reservations').delete().eq('id', row.reservation_id)
    await admin.from('products').delete().eq('id', childId)
    await admin.from('products').delete().eq('id', productId)
    await admin.auth.admin.deleteUser(userId)
  })
  return row.reservation_id
}

async function claimedIds(): Promise<Array<{ reservation_id: number; leg: string; locker_number?: string | null }>> {
  const { data, error } = await admin.rpc('claim_reservations_due_for_locker_guide', { p_limit: 500 })
  if (error) throw new Error(error.message)
  return (data ?? []) as Array<{ reservation_id: number; leg: string; locker_number?: string | null }>
}

async function setup(id: number, patch: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from('rental_reservations').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

describe('무인보관함 안내 대상 선정 — 영업외시간 제한 없음 (Migration 674)', () => {
  it('W1: 방문 수령 + 30분 뒤(시간대 무관) + 계약완료 + 비밀번호 → 수령 안내 대상', async () => {
    const id = await newReservation()
    const t = kstAfter(30)
    await setup(id, { status: 'confirmed', pickup_method: 'visit', start_date: t.date, end_date: t.date, pickup_time: t.time, locker_password: '123456', locker_number: '7' })
    const got = await claimedIds()
    const hit = got.find(r => r.reservation_id === id && r.leg === 'pickup')
    expect(hit).toBeTruthy()
    expect(hit?.locker_number).toBe('7')
  })

  it('W2: 퀵서비스 수령도 대상', async () => {
    const id = await newReservation()
    const t = kstAfter(30)
    await setup(id, { status: 'confirmed', pickup_method: 'quick', start_date: t.date, end_date: t.date, pickup_time: t.time, locker_password: '7777' })
    expect((await claimedIds()).some(r => r.reservation_id === id && r.leg === 'pickup')).toBe(true)
  })

  it('W3: 방문 반납 + 30분 뒤 + 대여중 → 반납 안내 대상', async () => {
    const id = await newReservation()
    const t = kstAfter(30)
    await setup(id, { status: 'in_use', pickup_method: 'visit', return_method: 'visit', start_date: t.date, end_date: t.date, return_time: t.time, locker_password: '98765432' })
    expect((await claimedIds()).some(r => r.reservation_id === id && r.leg === 'return')).toBe(true)
  })

  it('W4: 제외 — 90분 뒤·비밀번호 없음·신청대기 상태·택배 방식', async () => {
    const far = await newReservation(); const none = await newReservation(); const hold = await newReservation(); const post = await newReservation()
    const t90 = kstAfter(90); const t30 = kstAfter(30)
    await setup(far,  { status: 'confirmed', pickup_method: 'visit', start_date: t90.date, end_date: t90.date, pickup_time: t90.time, locker_password: '1234' })
    await setup(none, { status: 'confirmed', pickup_method: 'visit', start_date: t30.date, end_date: t30.date, pickup_time: t30.time, locker_password: null })
    await setup(hold, { status: 'hold',      pickup_method: 'visit', start_date: t30.date, end_date: t30.date, pickup_time: t30.time, locker_password: '1234' })
    await setup(post, { status: 'confirmed', pickup_method: 'epost', start_date: t30.date, end_date: t30.date, pickup_time: t30.time, locker_password: '1234' })
    const ids = (await claimedIds()).map(r => r.reservation_id)
    for (const x of [far, none, hold, post]) expect(ids.includes(x), String(x)).toBe(false)
  })

  it('W5: 이미 지난 시각은 제외, 한 번 선정되면 다시 선정되지 않는다', async () => {
    const past = await newReservation(); const once = await newReservation()
    const tp = kstAfter(-10); const t30 = kstAfter(30)
    await setup(past, { status: 'confirmed', pickup_method: 'visit', start_date: tp.date, end_date: tp.date, pickup_time: tp.time, locker_password: '1234' })
    await setup(once, { status: 'confirmed', pickup_method: 'visit', start_date: t30.date, end_date: t30.date, pickup_time: t30.time, locker_password: '1234' })
    const first = (await claimedIds()).map(r => r.reservation_id)
    expect(first.includes(past)).toBe(false)
    expect(first.includes(once)).toBe(true)
    expect((await claimedIds()).map(r => r.reservation_id).includes(once)).toBe(false)
  })

  it('W6: release_locker_guide_claim으로 표시를 되돌리면 다음 선정에서 다시 대상이 된다(발송 실패 재시도)', async () => {
    const id = await newReservation()
    const t = kstAfter(30)
    await setup(id, { status: 'confirmed', pickup_method: 'visit', start_date: t.date, end_date: t.date, pickup_time: t.time, locker_password: '1234' })
    expect((await claimedIds()).map(r => r.reservation_id).includes(id)).toBe(true)
    expect((await claimedIds()).map(r => r.reservation_id).includes(id)).toBe(false)
    const { error } = await admin.rpc('release_locker_guide_claim', { p_reservation_id: id, p_leg: 'pickup' })
    expect(error).toBeNull()
    expect((await claimedIds()).map(r => r.reservation_id).includes(id)).toBe(true)
    const bad = await admin.rpc('release_locker_guide_claim', { p_reservation_id: id, p_leg: 'nope' })
    expect(bad.error).not.toBeNull()
  })
})
