/**
 * TDD: crazychatActionDb.test.ts — 크레이지챗 접수형 실DB 검증 (Stage 전용)
 * 핵심: 접수는 chat_agent_requests에만 쓰고 예약은 바꾸지 않는다 / 같은 요청은 한 번만 / 타인 예약번호로는 접수 불가 / 고객 키로는 접수 테이블 접근 불가.
 * ⛔ Stage(ezyvffjvuwmtuhpxdjrw)에서만 실행(아니면 건너뜀). 설정 행은 끝에 전부 OFF로 복구한다.
 */
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'
import { approveTestCustomer } from '../helpers/approveTestCustomer'

vi.mock('$lib/server/push', () => ({ sendPushToUser: vi.fn(), sendUrgentChatAdminPush: vi.fn(), sendCrazychatRequestAdminPush: vi.fn() }))
import { runCrazychatAction } from '$lib/server/crazychat/action-runner'

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

const turnOn = () => admin.from('crazychat_settings').update({ agent_enabled: true, action_enabled: true }).eq('id', true)
const deps = () => ({ sendPush: vi.fn(), sendAdminPush: vi.fn().mockResolvedValue(undefined), sendUrgent: vi.fn().mockResolvedValue(undefined) })
const run = (c: { userId: string; sessionId: string }, messageId: string, content: string, d = deps()) =>
  runCrazychatAction(admin, { userId: c.userId, sessionId: c.sessionId, messageId, content, adminEngaged: false }, d as never)

describe.skipIf(!isStage)('크레이지챗 접수형 — 실DB(Stage)', () => {
  it('접수하면 chat_agent_requests에만 남고 예약은 전혀 바뀌지 않으며, 같은 요청을 다시 보내면 중복으로 안내한다', async () => {
    await turnOn()
    const A = await newCustomer('A')
    const product = await testProduct()
    const code = await reserve(A.client, product)
    const { data: before } = await admin.from('rental_reservations').select('*').eq('reservation_code', code)

    const d = deps()
    const m1 = await sendUserMessage(A.sessionId, A.userId, '예약 시간 변경하고 싶어요')
    const r1 = await run(A, m1, '예약 시간 변경하고 싶어요', d)
    expect(r1.handled).toBe(true)
    const { data: reqs } = await admin.from('chat_agent_requests').select('*').eq('user_id', A.userId)
    expect(reqs).toHaveLength(1)
    expect(reqs?.[0]).toMatchObject({ kind: 'time_change', reservation_code: code, status: 'pending', message_id: m1, session_id: A.sessionId, resolved_at: null })
    expect(JSON.stringify(reqs)).not.toContain('시간 변경하고')
    expect(d.sendAdminPush).toHaveBeenCalledTimes(1)

    const { data: after } = await admin.from('rental_reservations').select('*').eq('reservation_code', code)
    expect(after).toEqual(before)

    const { data: reply } = await admin.from('chat_messages').select('content, sender_type').eq('session_id', A.sessionId).eq('sender_type', 'ai')
    expect(reply?.[0].content).toContain('접수')
    expect(reply?.[0].content).toContain('확정된 것은 아니')

    // 같은 요청 재전송 → 중복(새 접수 없음, 관리자 푸시 없음)
    const d2 = deps()
    const m2 = await sendUserMessage(A.sessionId, A.userId, '예약 시간 변경하고 싶어요')
    const r2 = await run(A, m2, '예약 시간 변경하고 싶어요', d2)
    expect(r2.handled).toBe(true)
    expect(d2.sendAdminPush).not.toHaveBeenCalled()
    const { data: reqs2 } = await admin.from('chat_agent_requests').select('id').eq('user_id', A.userId)
    expect(reqs2).toHaveLength(1)
    const { data: obs } = await admin.from('crazychat_query_observations').select('outcome').in('message_id', [m1, m2])
    expect((obs ?? []).map((o) => o.outcome).sort()).toEqual(['duplicate', 'registered'])
  })

  it('고객 A가 고객 B의 예약번호를 말해도 접수되지 않는다', async () => {
    await turnOn()
    const A = await newCustomer('A2')
    const B = await newCustomer('B2')
    const product = await testProduct()
    await reserve(A.client, product)
    const codeB = await reserve(B.client, product)
    const content = `${codeB} 예약 시간 변경하고 싶어요`
    const m = await sendUserMessage(A.sessionId, A.userId, content)
    const d = deps()
    const r = await run(A, m, content, d)
    expect(r.handled).toBe(false)
    expect(d.sendAdminPush).not.toHaveBeenCalled()
    const { data: reqs } = await admin.from('chat_agent_requests').select('id').in('user_id', [A.userId, B.userId])
    expect(reqs).toHaveLength(0)
    const { data: obs } = await admin.from('crazychat_query_observations').select('outcome').eq('message_id', m).single()
    expect(obs?.outcome).toBe('not_found')
  })

  it('접수할 수 없는 단계의 예약만 있거나 예약이 없으면 접수하지 않는다', async () => {
    await turnOn()
    const A = await newCustomer('A3')
    const m = await sendUserMessage(A.sessionId, A.userId, '대여 연장하고 싶어요')
    const d = deps()
    expect((await run(A, m, '대여 연장하고 싶어요', d)).handled).toBe(false)
    const { data } = await admin.from('chat_agent_requests').select('id').eq('user_id', A.userId)
    expect(data).toHaveLength(0)
  })

  it('관찰 모드에서는 접수·고객 안내·관리자 알림이 없다', async () => {
    await admin.from('crazychat_settings').update({ agent_enabled: true, action_enabled: false, action_observe: true }).eq('id', true)
    const A = await newCustomer('A4')
    await reserve(A.client, await testProduct())
    const m = await sendUserMessage(A.sessionId, A.userId, '예약 시간 변경하고 싶어요')
    const d = deps()
    expect((await run(A, m, '예약 시간 변경하고 싶어요', d)).handled).toBe(false)
    const { data: reqs } = await admin.from('chat_agent_requests').select('id').eq('user_id', A.userId)
    expect(reqs).toHaveLength(0)
    const { data: ai } = await admin.from('chat_messages').select('id').eq('session_id', A.sessionId).eq('sender_type', 'ai')
    expect(ai).toHaveLength(0)
    expect(d.sendAdminPush).not.toHaveBeenCalled()
    const { data: obs } = await admin.from('crazychat_query_observations').select('mode, outcome').eq('message_id', m).single()
    expect(obs).toMatchObject({ mode: 'observe', outcome: 'registered' })
  })

  it('처리 상태 제약: 대기가 아니면 처리 시각이 있어야 하고, 같은 고객·종류·예약의 대기 요청은 하나만 가능하다(DB)', async () => {
    await turnOn()
    const A = await newCustomer('A5')
    await reserve(A.client, await testProduct())
    const m1 = await sendUserMessage(A.sessionId, A.userId, '연장 문의')
    const m2 = await sendUserMessage(A.sessionId, A.userId, '연장 문의2')
    const base = { user_id: A.userId, session_id: A.sessionId, kind: 'extend', reservation_code: 'TDDCODE0001' }
    expect((await admin.from('chat_agent_requests').insert({ ...base, message_id: m1 })).error).toBeNull()
    expect((await admin.from('chat_agent_requests').insert({ ...base, message_id: m2 })).error?.code).toBe('23505')
    // 처리됨(done)으로 바꾸면 처리 시각 없이는 안 된다
    const bad = await admin.from('chat_agent_requests').update({ status: 'done' }).eq('message_id', m1)
    expect(bad.error).not.toBeNull()
    const ok = await admin.from('chat_agent_requests').update({ status: 'done', resolved_at: new Date().toISOString() }).eq('message_id', m1)
    expect(ok.error).toBeNull()
    // 처리된 뒤에는 같은 종류를 다시 접수할 수 있다
    expect((await admin.from('chat_agent_requests').insert({ ...base, message_id: m2 })).error).toBeNull()
  })

  it('고객 키(anon·로그인)로는 접수 테이블을 읽거나 쓸 수 없다', async () => {
    const A = await newCustomer('A6')
    const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    for (const client of [anon, A.client]) {
      const read = await client.from('chat_agent_requests').select('*')
      expect(read.error !== null || (read.data ?? []).length === 0).toBe(true)
      const write = await client.from('chat_agent_requests').insert({ user_id: A.userId, session_id: A.sessionId, message_id: A.sessionId, kind: 'extend' })
      expect(write.error).not.toBeNull()
    }
  })
})
