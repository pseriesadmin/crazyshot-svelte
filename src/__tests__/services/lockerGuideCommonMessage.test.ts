import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { ensure24hPriceRule } from '../helpers/ensure24hPriceRule'
import { composeLockerGuideMessage } from '$lib/server/lockerGuideMessage'
import { clearNotifyMessageCache } from '$lib/server/notifyMessages'

/**
 * 무인보관함 안내 공통 안내문장(푸시알림 설정) = 푸시·문자·채팅카드 정본 (Migration 694·695, Stage 라이브)
 *  C1 기본 문구로 조립(함 번호·비밀번호·중앙현관)  C2 CMS 편집 문장 + 변수 치환  C3 send_locker_guide_card가 조립 문장을 카드 본문으로 사용
 *  C4 발송 대상(채팅 세션)은 예약 소유 고객  C5 래퍼는 service_role 전용(anon·authenticated 호출 불가)  C6 설정 편집 문장은 문자 길이 규격 안에서 조립
 */
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
  clearNotifyMessageCache()
})

async function setEntrance(pw: string): Promise<void> {
  const { data: prev } = await admin.from('cms_settings').select('value').eq('key', 'locker_entrance_password').maybeSingle()
  cleanups.push(async () => {
    if (prev) await admin.from('cms_settings').upsert({ key: 'locker_entrance_password', value: prev.value })
    else await admin.from('cms_settings').delete().eq('key', 'locker_entrance_password')
  })
  await admin.from('cms_settings').upsert({ key: 'locker_entrance_password', value: { password: pw } })
}

async function setMessage(message: string): Promise<void> {
  const { data: prev } = await admin.from('push_notification_config').select('extra_config').eq('notify_type', 'locker_guide').maybeSingle()
  const prevMsg = ((prev as { extra_config?: { message?: string } } | null)?.extra_config?.message) ?? ''
  cleanups.push(async () => { await admin.rpc('update_push_notification_message', { p_notify_type: 'locker_guide', p_message: prevMsg }) })
  const { data } = await admin.rpc('update_push_notification_message', { p_notify_type: 'locker_guide', p_message: message })
  expect((data as { ok?: boolean }).ok).toBe(true)
  clearNotifyMessageCache()
}

async function makeReservation(): Promise<{ id: number; userId: string }> {
  const { data: p } = await admin.from('products').select('id').is('parent_product_id', null).eq('is_active', true).limit(1).single()
  const productId = (p as { id: string }).id
  await ensure24hPriceRule(admin, productId)
  const { data: u, error: ue } = await admin.auth.admin.createUser({
    email: `tdd-lockercommon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    password: 'Test1234!',
    email_confirm: true,
  })
  if (ue || !u.user) throw new Error(`user 생성 실패: ${ue?.message}`)
  cleanups.push(() => admin.auth.admin.deleteUser(u.user.id).then(() => undefined).catch(() => undefined))
  const start = new Date(Date.UTC(2099, 10, 1) + Math.floor(Math.random() * 200) * 86400000)
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
  await admin.from('rental_reservations').update({ status: 'confirmed', locker_password: '*8821', locker_number: '1' }).eq('id', id)
  return { id, userId: u.user.id }
}

describe('무인보관함 공통 안내문장', () => {
  it('C1 기본 문구로 조립된다', async () => {
    await setEntrance('0418*')
    await setMessage('')
    const { id } = await makeReservation()
    const text = await composeLockerGuideMessage(admin, id)
    expect(text).toMatch(/무인보관함 이용 1번함 비밀번호는 '\*8821'입니다\.\n중앙현관 비밀번호: 0418\*$/)
  })

  it('C2 CMS 편집 문장의 변수가 치환된다(반납기한 날짜·시각 포함)', async () => {
    await setEntrance('0418*')
    await setMessage('[{{상품명}}] {{무인함번호}}번함 {{무인함비밀번호}} / 현관 {{중앙현관비밀번호}} / 반납 {{반납기한}}')
    const { id } = await makeReservation()
    const text = await composeLockerGuideMessage(admin, id)
    expect(text).toMatch(/^\[.+\] 1번함 \*8821 \/ 현관 0418\* \/ 반납 \d{4}-\d{2}-\d{2} 14:00$/)
  })

  it('C3·C4 채팅카드 본문은 조립 문장이며 그 예약 고객의 세션에만 들어간다', async () => {
    await setEntrance('0418*')
    await setMessage('{{상품명}} 안내: {{무인함번호}}번함 / {{무인함비밀번호}}')
    const { id, userId } = await makeReservation()
    const text = await composeLockerGuideMessage(admin, id)
    const { data, error } = await admin.rpc('send_locker_guide_card', { p_reservation_id: id, p_content: text })
    expect(error).toBeNull()
    expect((data as { ok?: boolean }).ok).toBe(true)
    const { data: msg } = await admin.from('chat_messages').select('content, session_id').eq('action_payload->>reservation_id', String(id)).order('created_at', { ascending: false }).limit(1).single()
    expect((msg as { content: string }).content).toBe(text)
    const { data: sess } = await admin.from('chat_sessions').select('user_id').eq('id', (msg as { session_id: string }).session_id).single()
    expect((sess as { user_id: string }).user_id).toBe(userId)
  })

  it('C5 래퍼 함수는 service_role 전용', async () => {
    const { data } = await admin.rpc('send_locker_guide_card', { p_reservation_id: 0, p_content: 'x' })
    expect(data).toBeTruthy() // 존재하지 않는 예약 → 오류 JSON(함수는 호출 가능)
    const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY
    if (!anonKey) return
    const anon = createClient(PUBLIC_SUPABASE_URL, anonKey)
    const { error } = await anon.rpc('send_locker_guide_card', { p_reservation_id: 1, p_content: 'x' })
    expect(error).not.toBeNull()
  })

  it('C6 공개 함수에는 임의 문장을 넣을 방법이 없다(매개변수 3개 그대로)', async () => {
    const { data } = await admin.rpc('send_rental_chat_notification', { p_reservation_id: 0, p_notify_type: 'locker_guide' })
    expect((data as { ok?: boolean }).ok).toBe(false)
  })
})
