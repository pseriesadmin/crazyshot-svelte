/**
 * TDD: crazychatQueryDb.test.ts — 크레이지챗 조회형 실DB 검증 (Stage 전용)
 * 핵심: 고객 A는 어떤 말을 해도 고객 B의 예약·서류를 볼 수 없다 / 꺼져 있으면 읽지 않는다 / 관찰 기록에 원문이 없다.
 * ⛔ Stage(ezyvffjvuwmtuhpxdjrw)에서만 실행(아니면 건너뜀). 설정 행은 끝에 전부 OFF로 복구한다.
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'
import { approveTestCustomer } from '../helpers/approveTestCustomer'

vi.mock('$lib/server/push', () => ({ sendPushToUser: vi.fn() }))
import { runCrazychatQuery } from '$lib/server/crazychat/agent'

const isStage = PUBLIC_SUPABASE_URL.includes('ezyvffjvuwmtuhpxdjrw')
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const RESET = {
  agent_enabled: false, query_enabled: false, query_observe: false,
  action_enabled: false, action_observe: false, ai_fallback_enabled: false, ai_fallback_observe: false,
  ai_allowed_categories: [] as string[],
}
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.().catch(() => undefined)
})
afterAll(async () => {
  if (isStage) await admin.from('crazychat_settings').update(RESET).eq('id', true)
})

async function newCustomer(label: string): Promise<{ userId: string; sessionId: string; client: SupabaseClient }> {
  const email = `tdd-crazychat-q-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !data.user) throw new Error(`사용자 생성 실패: ${error?.message}`)
  const userId = data.user.id
  await approveTestCustomer(admin, userId)
  const client = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
  const { error: lErr } = await client.auth.signInWithPassword({ email, password: 'Test1234!' })
  if (lErr) throw new Error(`로그인 실패: ${lErr.message}`)
  const { data: sess, error: sErr } = await admin.from('chat_sessions').insert({ user_id: userId, status: 'open', context_type: 'general' }).select('id').single()
  if (sErr || !sess) throw new Error(`세션 생성 실패: ${sErr?.message}`)
  cleanups.push(async () => {
    await admin.from('chat_sessions').delete().eq('id', sess.id)
    await admin.from('rental_reservations').delete().eq('user_id', userId)
    await admin.auth.admin.deleteUser(userId)
  })
  return { userId, sessionId: sess.id as string, client }
}

/** 테스트 전용 상품(부모 + 자식 재고 3개) — 예약은 정식 RPC(create_hold_reservation)로만 만든다(H-01) */
async function testProduct(): Promise<string> {
  const { data: parent, error } = await admin
    .from('products')
    .insert({ name: `[TDD-CCQ] ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, category: 'other', is_active: true })
    .select('id')
    .single()
  if (error || !parent) throw new Error(`부모 생성 실패: ${error?.message}`)
  const parentId = (parent as { id: string }).id
  cleanups.push(async () => {
    await admin.from('rental_reservations').delete().eq('product_id', parentId)
    const { data: kids } = await admin.from('products').select('id').eq('parent_product_id', parentId)
    const ids = ((kids ?? []) as Array<{ id: string }>).map((k) => k.id)
    if (ids.length) await admin.from('rental_reservations').delete().in('product_id', ids)
    await admin.from('products').delete().eq('parent_product_id', parentId)
    await admin.from('products').delete().eq('id', parentId)
  })
  for (let i = 0; i < 3; i++) {
    const { error: cErr } = await admin.from('products').insert({ name: `[TDD-CCQ] 자식${i}`, category: 'other', is_active: true, parent_product_id: parentId })
    if (cErr) throw new Error(`자식 생성 실패: ${cErr.message}`)
  }
  return parentId
}

async function sendUserMessage(sessionId: string, userId: string, content: string): Promise<string> {
  const { data, error } = await admin.from('chat_messages').insert({ session_id: sessionId, sender_type: 'user', content, message_type: 'text' }).select('id').single()
  if (error || !data) throw new Error(`메시지 생성 실패: ${error?.message}`)
  void userId
  return data.id as string
}

/** 고객 본인 JWT로 예약(hold)을 만들고 DB가 발급한 예약번호를 돌려준다 */
async function reserve(client: SupabaseClient, productId: string): Promise<string> {
  // 먼 미래의 무작위 이틀 구간(다른 데이터와 겹치지 않게)
  const base = new Date(Date.UTC(2034, 0, 1) + Math.floor(Math.random() * 3000) * 86_400_000)
  const start = base.toISOString().slice(0, 10)
  const end = new Date(base.getTime() + 86_400_000).toISOString().slice(0, 10)
  const { data, error } = await client.rpc('create_hold_reservation', { p_product_id: productId, p_start_date: start, p_end_date: end })
  const row = (data as Array<{ success: boolean; reservation_id: number; error_message: string | null }> | null)?.[0]
  if (error || !row?.success) throw new Error(`hold 실패: ${error?.message ?? row?.error_message}`)
  const { data: r } = await admin.from('rental_reservations').select('reservation_code').eq('id', row.reservation_id).single()
  const c = (r as { reservation_code: string | null } | null)?.reservation_code
  if (!c) throw new Error('예약번호 없음')
  return c
}

const turnOn = () => admin.from('crazychat_settings').update({ agent_enabled: true, query_enabled: true }).eq('id', true)

describe.skipIf(!isStage)('크레이지챗 조회형 — 실DB(Stage)', () => {
  it('고객 A가 고객 B의 예약번호를 말해도 답하지 않고, 본인 예약은 정상 조회된다', async () => {
    await turnOn()
    const A = await newCustomer('A')
    const B = await newCustomer('B')
    const product = await testProduct()
    const codeA = await reserve(A.client, product)
    const codeB = await reserve(B.client, product)

    // A → B의 번호
    const m1 = await sendUserMessage(A.sessionId, A.userId, `${codeB} 예약 상태 확인해줘`)
    const r1 = await runCrazychatQuery(admin, { userId: A.userId, sessionId: A.sessionId, messageId: m1, content: `${codeB} 예약 상태 확인해줘`, adminEngaged: false }, { sendPush: vi.fn() })
    expect(r1.handled).toBe(false)
    const { data: leaked } = await admin.from('chat_messages').select('content').eq('session_id', A.sessionId).eq('sender_type', 'ai')
    expect(JSON.stringify(leaked)).not.toContain(codeB)
    const { data: obs1 } = await admin.from('crazychat_query_observations').select('outcome, group_count').eq('message_id', m1).single()
    expect(obs1).toMatchObject({ outcome: 'not_found', group_count: 0 })

    // A → 본인 번호 없이 "내 예약" — A의 것만 나온다(B의 코드는 응답에 없다)
    const m2 = await sendUserMessage(A.sessionId, A.userId, '내 예약 상태 확인해줘')
    const r2 = await runCrazychatQuery(admin, { userId: A.userId, sessionId: A.sessionId, messageId: m2, content: '내 예약 상태 확인해줘', adminEngaged: false }, { sendPush: vi.fn() })
    expect(r2.handled).toBe(true)
    const { data: replies } = await admin.from('chat_messages').select('content').eq('session_id', A.sessionId).eq('sender_type', 'ai')
    const text = JSON.stringify(replies)
    expect(text).toContain(codeA)
    expect(text).not.toContain(codeB)
  })

  it('기본(꺼짐) 상태에서는 조회하지 않고 아무 기록도 남기지 않는다', async () => {
    await admin.from('crazychat_settings').update(RESET).eq('id', true)
    const A = await newCustomer('off')
    await reserve(A.client, await testProduct())
    const m = await sendUserMessage(A.sessionId, A.userId, '내 예약 상태 확인해줘')
    const r = await runCrazychatQuery(admin, { userId: A.userId, sessionId: A.sessionId, messageId: m, content: '내 예약 상태 확인해줘', adminEngaged: false }, { sendPush: vi.fn() })
    expect(r.handled).toBe(false)
    const { data } = await admin.from('crazychat_query_observations').select('id').eq('message_id', m)
    expect(data).toHaveLength(0)
  })

  it('관찰 모드: 고객에게 보내지 않고 기록만, 기록에 원문·예약번호가 없다', async () => {
    await admin.from('crazychat_settings').update({ agent_enabled: true, query_enabled: false, query_observe: true }).eq('id', true)
    const A = await newCustomer('obs')
    const c = await reserve(A.client, await testProduct())
    const content = `${c} 예약 상태 확인해줘`
    const m = await sendUserMessage(A.sessionId, A.userId, content)
    const r = await runCrazychatQuery(admin, { userId: A.userId, sessionId: A.sessionId, messageId: m, content, adminEngaged: false }, { sendPush: vi.fn() })
    expect(r.handled).toBe(false)
    const { data: ai } = await admin.from('chat_messages').select('id').eq('session_id', A.sessionId).eq('sender_type', 'ai')
    expect(ai).toHaveLength(0)
    const { data: obs } = await admin.from('crazychat_query_observations').select('*').eq('message_id', m).single()
    expect(obs).toMatchObject({ mode: 'observe', intent: 'reservation_status', outcome: 'answered', group_count: 1 })
    expect(JSON.stringify(obs)).not.toContain(c)
    expect(JSON.stringify(obs)).not.toContain('예약 상태')
  })

  it('고객 키(anon·로그인)로는 관찰 기록을 읽을 수 없다', async () => {
    const { PUBLIC_SUPABASE_ANON_KEY } = await import('$env/static/public')
    const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    const read = await anon.from('crazychat_query_observations').select('*')
    expect(read.error !== null || (read.data ?? []).length === 0).toBe(true)
  })
})
