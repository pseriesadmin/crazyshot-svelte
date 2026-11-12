import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'
import { createTestProduct } from '../helpers/createTestProduct'

/**
 * send_rental_chat_notification 의 상품명 표기 인자(p_product_label) — Migration #819 (Stage 라이브)
 *  L1 return_remind 카드: 라벨을 주면 본문·payload 상품명이 '대표 상품명 외 N개 상품' 이 된다
 *  L2 라벨을 비우면 기존과 같다(예약의 상품명 + ' 반납 예정 알림')
 *  L3 인자 3개로 부르던 기존 호출도 그대로 동작한다
 *  L4 비로그인(anon)·익명 로그인(authenticated)은 새 인자를 붙여도 실행할 수 없다(권한 거부 42501 — service_role 전용 유지)
 */
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
})

async function makeReservation(): Promise<{ id: number; productName: string; userId: string }> {
  const { data: u, error } = await admin.auth.admin.createUser({
    email: `tdd-label-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    password: 'Test1234!',
    email_confirm: true,
  })
  if (error || !u.user) throw new Error(`user 생성 실패: ${error?.message}`)
  const userId = u.user.id
  cleanups.push(async () => {
    const { data: sessions } = await admin.from('chat_sessions').select('id').eq('user_id', userId)
    const sids = ((sessions ?? []) as { id: string }[]).map((s) => s.id)
    if (sids.length) await admin.from('chat_messages').delete().in('session_id', sids)
    await admin.from('chat_sessions').delete().eq('user_id', userId)
    await admin.auth.admin.deleteUser(userId).catch(() => undefined)
  })
  const product = await createTestProduct(admin, 'label')
  cleanups.push(() => product.cleanup())
  const { data: parent } = await admin.from('products').select('name').eq('id', product.parentId).single()
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  // eslint-disable-next-line no-restricted-syntax -- 테스트 픽스처: 대여중 상태 예약 행이 필요하고 예약 배정 RPC는 이 검증과 무관
  const { data, error: re } = await admin
    .from('rental_reservations')
    .insert({ user_id: userId, product_id: product.childId, start_date: today, end_date: today, status: 'hold', pickup_method: 'visit', return_method: 'visit', pickup_time: '10:00', return_time: '18:00' })
    .select('id')
    .single()
  if (re || !data) throw new Error(`예약 생성 실패: ${re?.message}`)
  const id = (data as { id: number }).id
  cleanups.push(async () => {
    await admin.from('rental_reservations').delete().eq('id', id)
  })
  await admin.from('rental_reservations').update({ status: 'in_use' }).eq('id', id)
  return { id, productName: (parent as { name: string }).name, userId }
}

async function lastCard(userId: string): Promise<{ content: string; product_name: string | null }> {
  const { data: sessions } = await admin.from('chat_sessions').select('id').eq('user_id', userId)
  const sids = ((sessions ?? []) as { id: string }[]).map((s) => s.id)
  const { data: msgs } = await admin.from('chat_messages').select('content, action_payload, created_at').in('session_id', sids).order('created_at', { ascending: false }).limit(1)
  const m = (msgs ?? [])[0] as { content: string; action_payload: { product_name?: string | null } } | undefined
  return { content: m?.content ?? '', product_name: m?.action_payload?.product_name ?? null }
}

describe('send_rental_chat_notification — 상품명 표기 인자(#819)', { timeout: 90000 }, () => {
  it('L1·L2 라벨을 주면 묶음 표기, 비우면 기존 표기', async () => {
    const r = await makeReservation()
    const withLabel = await admin.rpc('send_rental_chat_notification', { p_reservation_id: r.id, p_notify_type: 'return_remind', p_product_label: `${r.productName} 외 2개 상품` })
    expect(withLabel.error).toBeNull()
    expect((withLabel.data as { ok?: boolean }).ok).toBe(true)
    const c1 = await lastCard(r.userId)
    expect(c1.content).toBe(`${r.productName} 외 2개 상품 반납 예정 알림`)
    expect(c1.product_name).toBe(`${r.productName} 외 2개 상품`)

    const noLabel = await admin.rpc('send_rental_chat_notification', { p_reservation_id: r.id, p_notify_type: 'return_remind' })
    expect(noLabel.error).toBeNull()
    const c2 = await lastCard(r.userId)
    expect(c2.content).toBe(`${r.productName} 반납 예정 알림`)
    expect(c2.product_name).toBe(r.productName)
  })

  it('L3 기존 3-인자 형태(p_action_url 포함) 호출도 동작', async () => {
    const r = await makeReservation()
    const res = await admin.rpc('send_rental_chat_notification', { p_reservation_id: r.id, p_notify_type: 'return_remind', p_action_url: '/account/rental' })
    expect(res.error).toBeNull()
    expect((res.data as { ok?: boolean }).ok).toBe(true)
  })

  it('L4 비로그인·익명 로그인 사용자는 실행할 수 없다(실제 anon 키, 새 인자 포함)', async () => {
    const args = { p_reservation_id: -1, p_notify_type: 'return_remind', p_product_label: 'X 외 1개 상품' }
    const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    const r1 = await anon.rpc('send_rental_chat_notification', args)
    expect(r1.error?.code).toBe('42501')

    const signed = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    const { error: signErr } = await signed.auth.signInAnonymously()
    if (signErr) return // 익명 로그인이 꺼진 환경이면 anon 검증으로 대체
    const r2 = await signed.rpc('send_rental_chat_notification', args)
    expect(r2.error?.code).toBe('42501')
  })
})
