/**
 * lockerGuideLegsClaim.test.ts — 무인보관함 안내 발송 대상(수령/반납) 선택이 실제 DB에서 지켜지는지 (Migration #787)
 *  G1 수령 건: legs=pickup·both·NULL(옛 저장분)만 대상, legs=return 은 제외
 *  G2 반납 건: legs=return·both·NULL만 대상, legs=pickup 은 제외
 *  G3 제외된 건은 다음 선정에서도 나오지 않는다(발송 표시도 남지 않아 나중에 선택을 바꾸면 다시 대상이 된다)
 *  G4 저장 함수: 비밀번호를 저장할 때 발송 대상 필수·허용값 3종·삭제 시 발송 대상도 비움·번호/비밀번호 짝
 *  G5 DB 체크: 허용값 밖은 저장 불가
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

function kstAfter(offsetMin: number): { date: string; time: string } {
  const t = new Date(Date.now() + offsetMin * 60_000)
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(t)
  const g = (k: string): string => parts.find(p => p.type === k)?.value ?? ''
  const hh = g('hour') === '24' ? '00' : g('hour')
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${hh}:${g('minute')}` }
}

interface Fixture { reservationId: number; userId: string; client: SupabaseClient }

async function newReservation(): Promise<Fixture> {
  const email = `tdd-legs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`
  const { data: u, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !u.user) throw new Error(`user 생성 실패: ${error?.message}`)
  const userId = u.user.id
  await approveTestCustomer(admin, userId)
  const client: SupabaseClient = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
  await client.auth.signInWithPassword({ email, password: 'Test1234!' })
  const { data: p } = await admin.from('products').insert({ name: `[TDD-LEGS] ${Date.now()}`, category: 'other', is_active: true }).select('id').single()
  const productId = (p as { id: string }).id
  const { data: c } = await admin.from('products').insert({ name: '[TDD-LEGS] 자식', category: 'other', is_active: true, parent_product_id: productId }).select('id').single()
  const childId = (c as { id: string }).id
  const d = new Date(Date.UTC(2044, 0, 1 + Math.floor(Math.random() * 300) * 3))
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
  return { reservationId: row.reservation_id, userId, client }
}

async function claimedLegs(id: number): Promise<string[]> {
  const { data, error } = await admin.rpc('claim_reservations_due_for_locker_guide', { p_limit: 500 })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Array<{ reservation_id: number; leg: string }>).filter(r => r.reservation_id === id).map(r => r.leg)
}

async function patch(id: number, p: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from('rental_reservations').update(p).eq('id', id)
  if (error) throw new Error(error.message)
}

/** 30분 뒤에 수령하는 계약완료 방문 예약 */
async function pickupDue(legs: string | null): Promise<number> {
  const f = await newReservation()
  const t = kstAfter(30)
  await patch(f.reservationId, { status: 'confirmed', pickup_method: 'visit', start_date: t.date, end_date: t.date, pickup_time: t.time, locker_password: '1234', locker_number: '3', locker_guide_legs: legs })
  return f.reservationId
}
/** 30분 뒤에 반납하는 대여중 방문 예약 */
async function returnDue(legs: string | null): Promise<number> {
  const f = await newReservation()
  const t = kstAfter(30)
  await patch(f.reservationId, { status: 'in_use', pickup_method: 'visit', return_method: 'visit', start_date: t.date, end_date: t.date, return_time: t.time, locker_password: '1234', locker_number: '3', locker_guide_legs: legs })
  return f.reservationId
}

describe('G1 수령 건의 발송 대상 선택', () => {
  it('pickup·both·NULL(옛 저장분)은 수령 안내 대상, return 만 고른 건은 제외', async () => {
    const a = await pickupDue('pickup'); const b = await pickupDue('both'); const c = await pickupDue(null); const d = await pickupDue('return')
    const got = new Map<number, string[]>()
    const { data } = await admin.rpc('claim_reservations_due_for_locker_guide', { p_limit: 500 })
    for (const r of (data ?? []) as Array<{ reservation_id: number; leg: string }>) got.set(r.reservation_id, [...(got.get(r.reservation_id) ?? []), r.leg])
    expect(got.get(a)).toEqual(['pickup'])
    expect(got.get(b)).toEqual(['pickup'])
    expect(got.get(c)).toEqual(['pickup'])
    expect(got.has(d)).toBe(false)
  }, 60_000)
})

describe('G2 반납 건의 발송 대상 선택', () => {
  it('return·both·NULL(옛 저장분)은 반납 안내 대상, pickup 만 고른 건은 제외', async () => {
    const a = await returnDue('return'); const b = await returnDue('both'); const c = await returnDue(null); const d = await returnDue('pickup')
    const got = new Map<number, string[]>()
    const { data } = await admin.rpc('claim_reservations_due_for_locker_guide', { p_limit: 500 })
    for (const r of (data ?? []) as Array<{ reservation_id: number; leg: string }>) got.set(r.reservation_id, [...(got.get(r.reservation_id) ?? []), r.leg])
    expect(got.get(a)).toEqual(['return'])
    expect(got.get(b)).toEqual(['return'])
    expect(got.get(c)).toEqual(['return'])
    expect(got.has(d)).toBe(false)
  }, 60_000)
})

describe('G3 제외된 건은 선택을 바꾸면 다시 대상이 된다', () => {
  it('수령만 고른 반납 건: 선정에서 빠지고 발송 표시도 안 남음 → 반납으로 바꾸면 대상', async () => {
    const id = await returnDue('pickup')
    expect(await claimedLegs(id)).toEqual([])
    expect(await claimedLegs(id)).toEqual([])
    const { data } = await admin.from('rental_reservations').select('locker_guide_sent_return_at').eq('id', id).single()
    expect((data as { locker_guide_sent_return_at: string | null }).locker_guide_sent_return_at).toBeNull()
    await patch(id, { locker_guide_legs: 'both' })
    expect(await claimedLegs(id)).toEqual(['return'])
    expect(await claimedLegs(id)).toEqual([]) // 한 번 나가면 다시 선정되지 않는다
  }, 60_000)
})

describe('G4 저장 함수 update_reservation_locker_password(4인자)', () => {
  async function cmsClient(userId: string): Promise<SupabaseClient> {
    const email = `tdd-legs-cms-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`
    const { data: u } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
    const cmsId = u.user?.id as string
    cleanups.push(async () => { await admin.auth.admin.deleteUser(cmsId) })
    // user_profiles 행은 가입 트리거가 만든다 — 행을 새로 넣지 않고 등급만 부여(서버 경로 service_role 만 가능)
    const { error: roleErr } = await admin.from('user_profiles').update({ cms_role: 'manager' }).eq('id', cmsId)
    if (roleErr) throw new Error(`cms_role 설정 실패: ${roleErr.message}`)
    const c: SupabaseClient = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    const { error } = await c.auth.signInWithPassword({ email, password: 'Test1234!' })
    if (error) throw new Error(`cms 로그인 실패: ${error.message} (${userId})`)
    return c
  }
  const legsOf = async (id: number): Promise<{ pw: string | null; no: string | null; legs: string | null }> => {
    const { data } = await admin.from('rental_reservations').select('locker_password, locker_number, locker_guide_legs').eq('id', id).single()
    const r = data as { locker_password: string | null; locker_number: string | null; locker_guide_legs: string | null }
    return { pw: r.locker_password, no: r.locker_number, legs: r.locker_guide_legs }
  }

  it('발송 대상 없이 비밀번호 저장 → 거절 / 허용값 밖 → 거절 / 짝이 안 맞으면 → 거절', async () => {
    const f = await newReservation()
    const cms = await cmsClient(f.userId)
    const noLegs = await cms.rpc('update_reservation_locker_password', { p_reservation_id: f.reservationId, p_password: '1234', p_locker_number: '5' })
    expect(noLegs.error?.message).toContain('legs required')
    const bad = await cms.rpc('update_reservation_locker_password', { p_reservation_id: f.reservationId, p_password: '1234', p_locker_number: '5', p_legs: 'x' })
    expect(bad.error?.message).toContain('legs required')
    const half = await cms.rpc('update_reservation_locker_password', { p_reservation_id: f.reservationId, p_password: '1234', p_locker_number: null, p_legs: 'both' })
    expect(half.error?.message).toContain('required together')
    expect(await legsOf(f.reservationId)).toEqual({ pw: null, no: null, legs: null })
  }, 60_000)

  it('저장하면 번호·비밀번호·발송 대상이 함께 저장되고, 삭제하면 발송 대상도 비워진다', async () => {
    const f = await newReservation()
    const cms = await cmsClient(f.userId)
    for (const legs of ['pickup', 'return', 'both']) {
      const ok = await cms.rpc('update_reservation_locker_password', { p_reservation_id: f.reservationId, p_password: '1234', p_locker_number: '5', p_legs: legs })
      expect(ok.error, legs).toBeNull()
      expect(await legsOf(f.reservationId)).toEqual({ pw: '1234', no: '5', legs })
    }
    const del = await cms.rpc('update_reservation_locker_password', { p_reservation_id: f.reservationId, p_password: null, p_locker_number: null, p_legs: 'both' })
    expect(del.error).toBeNull()
    expect(await legsOf(f.reservationId)).toEqual({ pw: null, no: null, legs: null })
  }, 60_000)

  it('고객(CMS 권한 없음)은 저장할 수 없다', async () => {
    const f = await newReservation()
    const r = await f.client.rpc('update_reservation_locker_password', { p_reservation_id: f.reservationId, p_password: '1234', p_locker_number: '5', p_legs: 'both' })
    expect(r.error).not.toBeNull()
    expect(await legsOf(f.reservationId)).toEqual({ pw: null, no: null, legs: null })
  }, 60_000)
})

describe('G5 DB 체크 제약', () => {
  it('허용값 밖은 저장되지 않는다', async () => {
    const f = await newReservation()
    const { error } = await admin.from('rental_reservations').update({ locker_guide_legs: 'x' }).eq('id', f.reservationId)
    expect(error).not.toBeNull()
  }, 60_000)
})
