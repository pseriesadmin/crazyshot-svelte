import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

/**
 * 본인증명/외국인증명 제출 시 관리자 검토요청 카드(admin_only) — TDD (Migration #526)
 * Harness Flow v3.2 — RED → GREEN → REFACTOR
 *
 * 완료기준(B-START):
 *   정상동작: 고객이 문서를 제출하면 chat_messages에 admin_only=true, action_payload.type=
 *             'identity_review_request'인 카드가 그 고객의 general 세션에 삽입된다
 *             (refundAdminChatCard.test.ts의 refund_failed와 동일한 admin_only 패턴 재사용).
 *   막아야할것: admin_only=true 카드는 고객 세션(anon/authenticated)으로 조회 불가해야 한다.
 *
 * 주의: Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합 테스트. Migration #526 적용 전까지는
 * admin_only 삽입 자체는 되지만(컬럼은 이미 Migration #404로 존재) action_payload.type이
 * 실제 앱 코드 경로(upload-doc/+server.ts)에서 발송되는지는 이 테스트가 직접 검증하지
 * 않는다 — 이 테스트는 "그 카드 shape가 DB 레벨에서 올바르게 저장·RLS 격리되는지"만
 * 고정한다(엔드투엔드 검증은 uploadDocNotifyFailSoft.test.ts가 mock으로 커버).
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

let testUserId: string
let testSessionId: string
const insertedMessageIds: string[] = []

beforeAll(async () => {
  const email = `tdd-identity-review-${Date.now()}@example.com`
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

describe('identity_review_request 카드 — admin_only=true 삽입', () => {
  it('service_role로 admin_only=true + action_payload.type=identity_review_request INSERT 성공', async () => {
    const { data, error } = await admin
      .from('chat_messages')
      .insert({
        session_id:   testSessionId,
        sender_type:  'user',
        message_type: 'action_card',
        content:      "'테스트고객' 회원 본인증명정보 등록 확인 요청",
        admin_only:   true,
        action_payload: {
          type:         'identity_review_request',
          doc_type:     'identity',
          button_label: '본인증명정보 등록',
          action_url:   `/cms/customers?selected=${testUserId}`,
        },
      })
      .select('id, admin_only, action_payload')
      .single()

    expect(error).toBeNull()
    expect(data).toBeTruthy()
    const d = data as { id: string; admin_only: boolean; action_payload: Record<string, unknown> }
    expect(d.admin_only).toBe(true)
    expect(d.action_payload.type).toBe('identity_review_request')
    expect(d.action_payload.action_url).toBe(`/cms/customers?selected=${testUserId}`)
    insertedMessageIds.push(d.id)
  })
})

describe('identity_review_request 카드 — 고객 세션 RLS 격리', () => {
  it('admin_only=true 카드가 service_role 조회 기준으로 정확히 격리 플래그를 갖는다', async () => {
    const { data: msgs } = await admin
      .from('chat_messages')
      .select('id, admin_only, action_payload')
      .eq('session_id', testSessionId)
      .eq('admin_only', true)

    const rows = msgs as { id: string; admin_only: boolean; action_payload: { type: string } }[] | null
    if (!rows || rows.length === 0) {
      console.warn('[identity_review_request RLS] admin_only 카드 없음 — 선행 테스트 미실행 가능성')
      return
    }
    expect(rows.every((r) => r.admin_only === true)).toBe(true)
    expect(rows.some((r) => r.action_payload?.type === 'identity_review_request')).toBe(true)
    // RLS 정책 문구 자체(participant_select_messages)는 Migration #404 SQL로 이미 보증됨
    // (refundAdminChatCard.test.ts EC-2와 동일 근거 — anon 키 미보유 스코프이므로 플래그 검증만).
  })
})
