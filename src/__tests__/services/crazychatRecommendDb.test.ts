/**
 * TDD: crazychatRecommendDb.test.ts — 크레이지챗 추천형 실DB 검증 (Stage 전용)
 * 핵심: 실제 상품 검색 인덱스로 찾은 대여 상품만 카드로 저장되고(판매전용·옵션전용·자식 제외) / 관찰 모드는 아무것도 보내지 않으며 /
 *       근거 없는 질문은 보내지 않고 / 카드가 빈 content로도 저장·조회된다.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

vi.mock('$lib/server/push', () => ({ sendPushToUser: vi.fn() }))
import { runCrazychatRecommend } from '$lib/server/crazychat/recommend-runner'
import { ALL_OFF, type CrazychatSettings } from '$lib/server/crazychat/settings'

const isStage = PUBLIC_SUPABASE_URL.includes('ezyvffjvuwmtuhpxdjrw')
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.().catch(() => undefined) })
const settings = (mode: 'observe' | 'on'): CrazychatSettings => ({ ...ALL_OFF, agentEnabled: true, recommend: { enabled: mode === 'on', observe: mode === 'observe' } })

async function setup(): Promise<{ userId: string; sessionId: string; messageId: string }> {
  const email = `tdd-crazychat-rec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !data.user) throw new Error(`사용자 생성 실패: ${error?.message}`)
  const userId = data.user.id
  const { data: sess, error: se } = await admin.from('chat_sessions').insert({ user_id: userId, status: 'open', context_type: 'general' }).select('id').single()
  if (se || !sess) throw new Error(`세션 생성 실패: ${se?.message}`)
  const { data: msg, error: me } = await admin.from('chat_messages').insert({ session_id: sess.id, sender_type: 'user', content: '질문', message_type: 'text' }).select('id').single()
  if (me || !msg) throw new Error(`메시지 생성 실패: ${me?.message}`)
  cleanups.push(async () => { await admin.from('chat_sessions').delete().eq('id', sess.id); await admin.auth.admin.deleteUser(userId) })
  return { userId, sessionId: sess.id as string, messageId: msg.id as string }
}

describe.skipIf(!isStage)('크레이지챗 추천형 — 실DB', () => {
  it('켜짐 모드: 실제 검색으로 찾은 대여 상품이 안내 1개 + 카드(최대 3장)로 저장되고 모두 대여 가능한 부모 상품이다', async () => {
    const { userId, sessionId, messageId } = await setup()
    const r = await runCrazychatRecommend(admin, { userId, sessionId, messageId, content: '렌즈 추천해 주세요', adminEngaged: false }, { settings: settings('on') })
    expect(r.handled).toBe(true)
    const { data: msgs } = await admin.from('chat_messages').select('sender_type, message_type, content, action_payload').eq('session_id', sessionId).eq('sender_type', 'ai').order('created_at', { ascending: true })
    const rows = msgs ?? []
    expect(rows[0]).toMatchObject({ message_type: 'text', action_payload: { type: 'crazychat_reply', source: 'recommend' } })
    const cards = rows.slice(1)
    expect(cards.length).toBeGreaterThanOrEqual(1)
    expect(cards.length).toBeLessThanOrEqual(3)
    for (const c of cards) expect(c).toMatchObject({ message_type: 'action_card', action_payload: { type: 'PRODUCT_CARD', is_expired: false } })
    const ids = cards.map((c) => (c.action_payload as { product_id: string }).product_id)
    const { data: prods } = await admin.from('products').select('id, parent_product_id, sale_only, option_only, is_active, deleted_at').in('id', ids)
    expect(prods).toHaveLength(ids.length)
    for (const p of prods ?? []) expect(p).toMatchObject({ parent_product_id: null, sale_only: false, option_only: false, is_active: true, deleted_at: null })
    for (const c of cards) {
      const p = c.action_payload as { product_price: number; action_url: string }
      expect(p.product_price).toBeGreaterThan(0)
      expect(p.action_url).toMatch(/^\/products\/.+/)
    }
    const { data: obs } = await admin.from('crazychat_query_observations').select('mode, intent, outcome, group_count').eq('message_id', messageId)
    expect(obs).toEqual([{ mode: 'on', intent: 'recommend', outcome: 'answered', group_count: cards.length }])
  })

  it('관찰 모드: 고객 세션에 아무 메시지도 생기지 않고 기록만 남는다', async () => {
    const { userId, sessionId, messageId } = await setup()
    const r = await runCrazychatRecommend(admin, { userId, sessionId, messageId, content: '렌즈 추천해 주세요', adminEngaged: false }, { settings: settings('observe') })
    expect(r).toEqual({ handled: false })
    const { data: msgs } = await admin.from('chat_messages').select('id').eq('session_id', sessionId).eq('sender_type', 'ai')
    expect(msgs).toHaveLength(0)
    const { data: obs } = await admin.from('crazychat_query_observations').select('mode, outcome').eq('message_id', messageId)
    expect(obs).toEqual([{ mode: 'observe', outcome: 'answered' }])
  })

  it('근거 없는 질문(존재하지 않는 종류)은 아무것도 보내지 않는다', async () => {
    const { userId, sessionId, messageId } = await setup()
    const r = await runCrazychatRecommend(admin, { userId, sessionId, messageId, content: '아프리카 낚시용 우주선 추천해 주세요', adminEngaged: false }, { settings: settings('on') })
    expect(r).toEqual({ handled: false })
    const { data: msgs } = await admin.from('chat_messages').select('id').eq('session_id', sessionId).eq('sender_type', 'ai')
    expect(msgs).toHaveLength(0)
  })

  it('추천형 설정 컬럼이 DB에 있고 기본은 꺼짐이다(Migration 669)', async () => {
    const { data, error } = await admin.from('crazychat_settings').select('recommend_enabled, recommend_observe').limit(1).single()
    expect(error).toBeNull()
    expect(data).toEqual({ recommend_enabled: false, recommend_observe: false })
  })
})
