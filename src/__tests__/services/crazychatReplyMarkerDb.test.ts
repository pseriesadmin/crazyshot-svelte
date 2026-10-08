/**
 * TDD: crazychatReplyMarkerDb.test.ts — 크레이지챗 텍스트 답변 표시값(action_payload)이 실DB에 저장되는지 (Stage 전용)
 * 검수(S6 M-1) 지적: 가짜 클라이언트 테스트만으로는 text 메시지 + payload 저장이 DB 제약·트리거에 막히지 않는지 알 수 없다.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

vi.mock('$lib/server/push', () => ({ sendPushToUser: vi.fn() }))
import { insertAgentMessage } from '$lib/server/crazychat/shared'

const isStage = PUBLIC_SUPABASE_URL.includes('ezyvffjvuwmtuhpxdjrw')
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.().catch(() => undefined) })

describe.skipIf(!isStage)('크레이지챗 답변 표시값 — 실DB 저장', () => {
  it('sender=ai·message_type=text 메시지에 표시값을 넣어 저장하고 그대로 읽힌다(출처별 3종)', async () => {
    const email = `tdd-crazychat-marker-${Date.now()}@example.com`
    const { data: u, error: ue } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
    if (ue || !u.user) throw new Error(`사용자 생성 실패: ${ue?.message}`)
    const { data: sess, error: se } = await admin.from('chat_sessions').insert({ user_id: u.user.id, status: 'open', context_type: 'general' }).select('id').single()
    if (se || !sess) throw new Error(`세션 생성 실패: ${se?.message}`)
    cleanups.push(async () => { await admin.from('chat_sessions').delete().eq('id', sess.id); await admin.auth.admin.deleteUser(u.user!.id) })

    for (const source of ['query', 'action', 'ai'] as const) {
      const msg = await insertAgentMessage(admin, sess.id as string, `테스트 답변 ${source}`, undefined, source)
      expect(msg, source).not.toBeNull()
      const { data } = await admin.from('chat_messages').select('sender_type, message_type, action_payload, content').eq('id', msg!.id).single()
      expect(data).toMatchObject({ sender_type: 'ai', message_type: 'text', action_payload: { type: 'crazychat_reply', source }, content: `테스트 답변 ${source}` })
    }
  })
})
