import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { ensure24hPriceRule } from '../helpers/ensure24hPriceRule'
import { composeLockerGuideMessage } from '$lib/server/lockerGuideMessage'
import { clearNotifyMessageCache } from '$lib/server/notifyMessages'

/**
 * 무인보관함 "반납용" 안내 — 실제 DB로 문장 조립 → 채팅카드까지 (Migration #787, Stage 라이브)
 *  D1 반납 기본 문구가 예약의 값(상품·함 번호·비밀번호·반납기한)으로 조립된다
 *  D2 반납 편집 문장(locker_return_guide)은 수령 문장(locker_guide)에 영향을 주지 않고, 반대도 마찬가지
 *  D3 반납 문장이 채팅카드 본문으로 그 예약 고객의 세션에 들어간다
 *  D4 설정 화면에 반납 안내 항목이 등록돼 있다(켜짐)
 * 중앙현관 비밀번호는 다른 무인보관함 테스트가 같은 설정을 바꾸므로 이 파일에서는 값을 단정하지 않는다.
 */
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
  clearNotifyMessageCache()
})

async function setMessage(notifyType: 'locker_guide' | 'locker_return_guide', message: string): Promise<void> {
  const { data: prev } = await admin.from('push_notification_config').select('extra_config').eq('notify_type', notifyType).maybeSingle()
  const prevMsg = ((prev as { extra_config?: { message?: string } } | null)?.extra_config?.message) ?? ''
  cleanups.push(async () => { await admin.rpc('update_push_notification_message', { p_notify_type: notifyType, p_message: prevMsg }) })
  const { data, error } = await admin.rpc('update_push_notification_message', { p_notify_type: notifyType, p_message: message })
  expect(error).toBeNull()
  expect((data as { ok?: boolean } | null)?.ok ?? true).toBe(true)
  clearNotifyMessageCache()
}

async function makeReservation(): Promise<{ id: number; userId: string }> {
  const { data: p } = await admin.from('products').select('id').is('parent_product_id', null).eq('is_active', true).limit(1).single()
  const productId = (p as { id: string }).id
  await ensure24hPriceRule(admin, productId)
  const { data: u, error: ue } = await admin.auth.admin.createUser({
    email: `tdd-lockerret-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    password: 'Test1234!',
    email_confirm: true,
  })
  if (ue || !u.user) throw new Error(`user 생성 실패: ${ue?.message}`)
  cleanups.push(() => admin.auth.admin.deleteUser(u.user.id).then(() => undefined).catch(() => undefined))
  const start = new Date(Date.UTC(2098, 10, 1) + Math.floor(Math.random() * 200) * 86400000)
  const end = new Date(start.getTime() + 86400000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const { data, error } = await admin.from('rental_reservations').insert({
    user_id: u.user.id, product_id: productId, start_date: fmt(start), end_date: fmt(end),
    status: 'hold', pickup_method: 'visit', return_method: 'visit', pickup_time: '10:00', return_time: '14:00',
  }).select('id').single()
  if (error || !data) throw new Error(`예약 생성 실패: ${error?.message}`)
  const id = (data as { id: number }).id
  cleanups.push(async () => {
    await admin.from('chat_messages').delete().eq('action_payload->>reservation_id', String(id))
    await admin.from('rental_reservations').delete().eq('id', id)
  })
  await admin.from('rental_reservations').update({ status: 'confirmed', locker_password: '*8821', locker_number: '1', locker_guide_legs: 'both' }).eq('id', id)
  return { id, userId: u.user.id }
}

describe('무인보관함 반납 안내 (DB 라이브)', () => {
  it('D1 반납 기본 문구가 예약의 값으로 조립된다', async () => {
    await setMessage('locker_return_guide', '')
    const { id } = await makeReservation()
    const text = (await composeLockerGuideMessage(admin, id, { leg: 'return' })) ?? ''
    expect(text).toContain('반납 안내예요')
    expect(text).toContain('1번함')
    expect(text).toContain("'*8821'")
    expect(text).toMatch(/반납 기한 \d{4}-\d{2}-\d{2} 14:00까지/)
    expect(text).toContain('연체 요금')
    expect(text).not.toContain('{{')
    // 수령 문장은 그대로(반납 문구가 섞이지 않는다)
    await setMessage('locker_guide', '')
    const pick = (await composeLockerGuideMessage(admin, id, { leg: 'pickup' })) ?? ''
    expect(pick).toContain("무인보관함 이용 1번함 비밀번호는 '*8821'입니다.")
    expect(pick).not.toContain('반납 안내예요')
  }, 60_000)

  it('D2 반납 편집 문장은 반납에만, 수령 편집 문장은 수령에만 적용된다', async () => {
    await setMessage('locker_return_guide', '[반납] {{무인함번호}}번함 {{무인함비밀번호}}')
    await setMessage('locker_guide', '[수령] {{무인함번호}}번함 {{무인함비밀번호}}')
    const { id } = await makeReservation()
    expect(await composeLockerGuideMessage(admin, id, { leg: 'return' })).toBe('[반납] 1번함 *8821')
    expect(await composeLockerGuideMessage(admin, id, { leg: 'pickup' })).toBe('[수령] 1번함 *8821')
    expect(await composeLockerGuideMessage(admin, id)).toBe('[수령] 1번함 *8821') // leg 생략 = 수령(기존 호출부 호환)
  }, 60_000)

  it('D3 반납 문장이 채팅카드 본문으로 그 예약 고객의 세션에 들어간다', async () => {
    await setMessage('locker_return_guide', '')
    const { id, userId } = await makeReservation()
    const text = await composeLockerGuideMessage(admin, id, { leg: 'return' })
    const { data, error } = await admin.rpc('send_locker_guide_card', { p_reservation_id: id, p_content: text })
    expect(error).toBeNull()
    expect((data as { ok?: boolean }).ok).toBe(true)
    const { data: msg } = await admin.from('chat_messages').select('content, session_id').eq('action_payload->>reservation_id', String(id)).order('created_at', { ascending: false }).limit(1).single()
    expect((msg as { content: string }).content).toBe(text)
    expect((msg as { content: string }).content).toContain('반납 안내예요')
    const { data: sess } = await admin.from('chat_sessions').select('user_id').eq('id', (msg as { session_id: string }).session_id).single()
    expect((sess as { user_id: string }).user_id).toBe(userId)
  }, 60_000)

  it('D4 설정 화면 항목(무인보관함 반납 안내)이 켜진 상태로 등록돼 있다', async () => {
    const { data } = await admin.from('push_notification_config').select('label, push_enabled, category').eq('notify_type', 'locker_return_guide').single()
    expect(data).toEqual({ label: '무인보관함 반납 안내', push_enabled: true, category: 'customer_lifecycle' })
  })
})
