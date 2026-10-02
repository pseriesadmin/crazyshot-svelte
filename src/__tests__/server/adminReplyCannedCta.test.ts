import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * admin-reply: 빠른답변을 선택해 보낼 때 그 답변의 CTA(이미지·버튼·링크)가 서버에서 canned_cta 카드로 붙는지
 * (2026-10-02 — 과거엔 content만 전송돼 CTA·링크가 빠졌다).
 */
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'k' } }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))
vi.mock('$lib/server/synonymLearning', () => ({ recordSynonymLearning: vi.fn().mockResolvedValue(undefined) }))
vi.mock('$lib/server/push', () => ({ sendPushToUser: vi.fn().mockResolvedValue(undefined) }))
vi.mock('$lib/server/crossLingualSynonymScan', () => ({ registerCrossLingualCandidates: vi.fn().mockResolvedValue(undefined) }))

let cannedRow: Record<string, unknown> | null = null
const insertSpy = vi.fn()

function makeAdmin() {
  return {
    from: (table: string) => {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.order = () => b
      b.limit = () => b
      b.update = () => b
      b.insert = (row: unknown) => { insertSpy(table, row); return b }
      b.single = async () => {
        if (table === 'user_profiles') return { data: { cms_role: 'manager' }, error: null }
        if (table === 'chat_sessions') return { data: { id: 's1', user_id: 'u1', admin_id: 'a1', status: 'open' }, error: null }
        if (table === 'chat_messages') return { data: { id: 'm1' }, error: null }
        return { data: null, error: null }
      }
      b.maybeSingle = async () => {
        if (table === 'canned_responses') return { data: cannedRow, error: null }
        return { data: null, error: null }
      }
      // update(...).eq(...) 체인 마지막 await 지원
      b.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null })
      return b
    },
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => makeAdmin() }))

import { POST } from '../../routes/api/chat/admin-reply/+server'

function call(body: Record<string, unknown>) {
  return POST({
    request: new Request('http://x/api/chat/admin-reply', { method: 'POST', body: JSON.stringify(body) }),
    locals: { safeGetSession: async () => ({ session: { user: { id: 'a1' } } }) },
  } as never)
}

function insertedMessage(): { message_type: string; action_payload: Record<string, unknown> | null } {
  const call = insertSpy.mock.calls.find((c) => c[0] === 'chat_messages')
  return call![1]
}

describe('POST /api/chat/admin-reply — 빠른답변 CTA 카드', () => {
  beforeEach(() => { insertSpy.mockClear(); cannedRow = null })

  it('CTA가 있는 빠른답변을 선택해 보내면 canned_cta 카드로 저장된다', async () => {
    cannedRow = { id: 'c1', image_url: null, cta_label: '자세히 보기', cta_url: 'https://crazyshot.kr/help' }
    const res = await call({ session_id: 's1', content: '안내드립니다', canned_response_id: 'c1' })
    expect(res.status).toBe(200)
    const m = insertedMessage()
    expect(m.message_type).toBe('action_card')
    expect(m.action_payload).toMatchObject({ type: 'canned_cta', button_label: '자세히 보기', action_url: 'https://crazyshot.kr/help', canned_response_id: 'c1' })
  })

  it('링크만 있는 빠른답변도 카드로 저장된다(버튼 텍스트 기본값)', async () => {
    cannedRow = { id: 'c2', image_url: null, cta_label: null, cta_url: '/help' }
    await call({ session_id: 's1', content: '안내', canned_response_id: 'c2' })
    const m = insertedMessage()
    expect(m.message_type).toBe('action_card')
    expect(m.action_payload).toMatchObject({ button_label: '확인하기', action_url: '/help' })
  })

  it('CTA가 없는 빠른답변은 기존처럼 텍스트로 저장된다', async () => {
    cannedRow = { id: 'c3', image_url: null, cta_label: null, cta_url: null }
    await call({ session_id: 's1', content: '안내', canned_response_id: 'c3' })
    const m = insertedMessage()
    expect(m.message_type).toBe('text')
    expect(m.action_payload).toBeNull()
  })

  it('빠른답변 없이 직접 입력한 메시지는 텍스트(회귀 없음)', async () => {
    const res = await call({ session_id: 's1', content: '직접 입력' })
    expect(res.status).toBe(200)
    expect(insertedMessage().message_type).toBe('text')
  })

  it('클라이언트가 보낸 action_payload(product_link 등)가 있으면 canned CTA로 덮어쓰지 않는다', async () => {
    cannedRow = { id: 'c1', image_url: null, cta_label: '열기', cta_url: '/help' }
    await call({ session_id: 's1', content: '상품', canned_response_id: 'c1', action_payload: { type: 'product_link' } })
    expect(insertedMessage().action_payload).toEqual({ type: 'product_link' })
  })
})
