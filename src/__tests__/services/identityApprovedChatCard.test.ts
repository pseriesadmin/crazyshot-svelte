import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

/**
 * 관리자 승인 완료 → 고객 수신 카드(identity_approved) — TDD (Migration #526)
 * Harness Flow v3.2 — RED → GREEN → REFACTOR
 *
 * 완료기준(B-START):
 *   정상동작: 승인 처리 시 chat_messages에 admin_only가 아닌(고객에게 보이는)
 *             action_payload.type='identity_approved' 카드가 삽입되고, 문구가 정확히
 *             '고객님 본인증명이 확인되었어요.'다.
 *   막아야할것: 이 카드는 admin_only=true로 삽입되면 안 된다(고객이 반드시 볼 수 있어야 함).
 *
 * 주의: Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합 테스트.
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

let testUserId: string
let testSessionId: string
const insertedMessageIds: string[] = []

beforeAll(async () => {
  const email = `tdd-identity-approved-${Date.now()}@example.com`
  const { data, error } = await admin.auth.admin.createUser({
    email, password: 'Test1234!', email_confirm: true,
  })
  if (error || !data.user) throw new Error(`사용자 생성 실패: ${error?.message}`)
  testUserId = data.user.id

  const { data: session, error: sessionErr } = await admin
    .from('chat_sessions')
    .insert({ user_id: testUserId, status: 'open', context_type: 'general' })
    .select('id')
    .single()
  if (sessionErr || !session) throw new Error(`세션 생성 실패: ${sessionErr?.message}`)
  testSessionId = (session as { id: string }).id
})

afterAll(async () => {
  if (insertedMessageIds.length > 0) {
    await admin.from('chat_messages').delete().in('id', insertedMessageIds)
  }
  if (testSessionId) await admin.from('chat_sessions').delete().eq('id', testSessionId)
  if (testUserId) await admin.auth.admin.deleteUser(testUserId)
})

describe('identity_approved 카드 — 고객 수신(admin_only 아님)', () => {
  it('admin_only 미지정(default false) + 정확한 문구로 INSERT 성공', async () => {
    const { data, error } = await admin
      .from('chat_messages')
      .insert({
        session_id:   testSessionId,
        sender_type:  'admin',
        message_type: 'action_card',
        content:      '고객님 본인증명이 확인되었어요.',
        action_payload: {
          type:         'identity_approved',
          doc_type:     'identity',
          button_label: '내 정보 확인하기',
          action_url:   '/account/profile?tab=profile',
        },
      })
      .select('id, admin_only, content, action_payload')
      .single()

    expect(error).toBeNull()
    const d = data as {
      id: string
      admin_only: boolean
      content: string
      action_payload: Record<string, unknown>
    }
    expect(d.admin_only).toBe(false)
    expect(d.content).toBe('고객님 본인증명이 확인되었어요.')
    expect(d.action_payload.type).toBe('identity_approved')
    insertedMessageIds.push(d.id)
  })
})
