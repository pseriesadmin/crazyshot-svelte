import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { ensure24hPriceRule } from '../helpers/ensure24hPriceRule'

/**
 * Migration 694 — 무인보관함 이용 안내 채팅카드(send_rental_chat_notification 'locker_guide') 문구 (Stage 라이브)
 *  L1 함 번호 + 중앙현관 비밀번호 + 반납기한에 시각 포함
 *  L2 함 번호가 없으면 "N번함" 부분 없이 기존 문구 형태
 *  L3 중앙현관 비밀번호 설정이 없으면 그 줄을 넣지 않는다
 *  L4 다른 알림(reservation_approval)의 반납기한은 날짜만(시각 미포함 — 회귀 방지)
 */
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
})

async function setEntrance(password: string | null): Promise<void> {
  const { data: prev } = await admin.from('cms_settings').select('value').eq('key', 'locker_entrance_password').maybeSingle()
  cleanups.push(async () => {
    if (prev) await admin.from('cms_settings').upsert({ key: 'locker_entrance_password', value: prev.value })
    else await admin.from('cms_settings').delete().eq('key', 'locker_entrance_password')
  })
  if (password === null) await admin.from('cms_settings').delete().eq('key', 'locker_entrance_password')
  else await admin.from('cms_settings').upsert({ key: 'locker_entrance_password', value: { password } })
}

async function makeReservation(lockerNumber: string | null): Promise<number> {
  const { data: p } = await admin.from('products').select('id').is('parent_product_id', null).eq('is_active', true).limit(1).single()
  const productId = (p as { id: string }).id
  await ensure24hPriceRule(admin, productId)
  const { data: u, error: ue } = await admin.auth.admin.createUser({
    email: `tdd-lockercard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    password: 'Test1234!',
    email_confirm: true,
  })
  if (ue || !u.user) throw new Error(`user 생성 실패: ${ue?.message}`)
  cleanups.push(() => admin.auth.admin.deleteUser(u.user.id).then(() => undefined).catch(() => undefined))
  const start = new Date(Date.UTC(2099, 8, 1) + Math.floor(Math.random() * 300) * 86400000)
  const end = new Date(start.getTime() + 86400000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const { data, error } = await admin.from('rental_reservations').insert({
    user_id: u.user.id, product_id: productId, start_date: fmt(start), end_date: fmt(end),
    status: 'hold', pickup_method: 'visit', return_method: 'visit', return_time: '14:00',
  }).select('id').single()
  if (error || !data) throw new Error(`예약 생성 실패: ${error?.message}`)
  const id = (data as { id: number }).id
  cleanups.push(async () => {
    await admin.from('chat_messages').delete().eq('action_payload->>reservation_id', String(id))
    await admin.from('rental_reservations').delete().eq('id', id)
  })
  await admin.from('rental_reservations').update({ status: 'confirmed', locker_password: '*8821', locker_number: lockerNumber }).eq('id', id)
  return id
}

async function sendCard(id: number, type: string): Promise<{ content: string; payload: Record<string, unknown> }> {
  const { data, error } = await admin.rpc('send_rental_chat_notification', { p_reservation_id: id, p_notify_type: type })
  expect(error).toBeNull()
  expect((data as { ok?: boolean }).ok).toBe(true)
  const { data: msg } = await admin.from('chat_messages').select('content, action_payload').eq('action_payload->>reservation_id', String(id)).order('created_at', { ascending: false }).limit(1).single()
  const m = msg as { content: string; action_payload: Record<string, unknown> }
  return { content: m.content, payload: m.action_payload }
}

describe('locker_guide 채팅카드 문구 (Migration 694)', () => {
  it('L1 함 번호 + 중앙현관 비밀번호 + 반납 시각', async () => {
    await setEntrance('0418*')
    const id = await makeReservation('1')
    const { content, payload } = await sendCard(id, 'locker_guide')
    expect(content).toContain("무인보관함 이용 1번함 비밀번호는 '*8821'입니다.")
    expect(content.endsWith('\n중앙현관 비밀번호: 0418*')).toBe(true)
    expect(String(payload.return_deadline)).toMatch(/^\d{4}-\d{2}-\d{2} 14:00$/)
  })

  it('L2 함 번호가 없으면 N번함 없이 기존 형태', async () => {
    await setEntrance('0418*')
    const id = await makeReservation(null)
    const { content } = await sendCard(id, 'locker_guide')
    expect(content).toContain("무인보관함 이용 비밀번호는 '*8821'입니다.")
    expect(content).not.toContain('번함')
  })

  it('L3 중앙현관 설정이 없으면 그 줄이 없다', async () => {
    await setEntrance(null)
    const id = await makeReservation('2')
    const { content } = await sendCard(id, 'locker_guide')
    expect(content).toContain('2번함')
    expect(content).not.toContain('중앙현관')
  })

  it('L4 다른 알림의 반납기한은 날짜만', async () => {
    const id = await makeReservation('1')
    const { payload } = await sendCard(id, 'reservation_approval')
    expect(String(payload.return_deadline)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
