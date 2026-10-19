// cmsChatInboxApi.test.ts — GET /api/cms/chat/inbox: 권한 가드·개수/목록 상한·이벤트 카드 exclude·긴급 배지
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  denied: null as Response | null,
  role: 'manager' as string | null,
  sessions: [] as unknown[],
  messages: [] as unknown[],
  urgentIds: [] as string[],
}))

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'test' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'http://localhost' }))
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: async () => state.denied }))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: async () => state.role }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      const chain: Record<string, unknown> = {}
      const result = () => {
        if (table === 'chat_sessions') return { data: state.sessions, error: null }
        if (table === 'chat_messages') return { data: state.messages, error: null }
        if (table === 'user_profiles') return { data: [{ id: 'u0', full_name: '홍길동', email: 'hong@x.kr' }], error: null }
        if (table === 'chat_intent_logs') return { data: state.urgentIds.map((message_id) => ({ message_id })), error: null }
        return { data: [], error: null }
      }
      const proxy: unknown = new Proxy(chain, {
        get(_t, prop: string) {
          if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result())
          return () => proxy
        },
      })
      return proxy
    },
  }),
}))

import { GET } from '../../routes/api/cms/chat/inbox/+server'

const NOW = Date.now()
const iso = (m: number) => new Date(NOW - m * 60_000).toISOString()
function call(qs = '') {
  return GET({ locals: {}, url: new URL(`http://localhost/api/cms/chat/inbox${qs}`) } as unknown as Parameters<typeof GET>[0])
}
function seed(n: number) {
  state.sessions = Array.from({ length: n }, (_, i) => ({ id: `s${i}`, user_id: 'u0', status: 'open', updated_at: iso(1) }))
  state.messages = Array.from({ length: n }, (_, i) => ({
    id: `m${i}`, session_id: `s${i}`, sender_type: 'user', message_type: 'text', content: `문의 ${i}`,
    action_payload: null, admin_only: false, created_at: iso(i + 1),
  }))
}

beforeEach(() => { state.denied = null; state.role = 'manager'; state.urgentIds = []; seed(0) })

describe('GET /api/cms/chat/inbox', () => {
  it('상담 메뉴 권한이 없으면 가드 응답을 그대로 돌려준다', async () => {
    state.denied = new Response('{}', { status: 403 })
    expect((await call()).status).toBe(403)
  })

  it('CMS 역할이 없으면 401', async () => {
    state.role = null
    expect((await call()).status).toBe(401)
  })

  it('개수는 전체, 목록은 최근 순 최대 10건 + 고객 이름', async () => {
    seed(13)
    const body = await (await call()).json()
    expect(body.count).toBe(13)
    expect(body.items).toHaveLength(10)
    expect(body.items[0]).toMatchObject({ session_id: 's0', name: '홍길동', kind: 'reply' })
  })

  it('긴급 분류된 고객 메시지에는 urgent=true', async () => {
    seed(2)
    state.urgentIds = ['m1']
    const body = await (await call()).json()
    expect(body.items.find((i: { message_id: string }) => i.message_id === 'm1').urgent).toBe(true)
    expect(body.items.find((i: { message_id: string }) => i.message_id === 'm0').urgent).toBe(false)
  })

  it('exclude로 확인 처리한 이벤트 카드는 빠지지만 응답 대기 건은 빠지지 않는다', async () => {
    const evId = '11111111-1111-4111-8111-111111111111'
    state.sessions = [
      { id: 'sa', user_id: 'u0', status: 'open', updated_at: iso(1) },
      { id: 'sb', user_id: 'u0', status: 'open', updated_at: iso(1) },
    ]
    state.messages = [
      { id: evId, session_id: 'sa', sender_type: 'admin', message_type: 'action_card', content: '서명 완료', action_payload: { type: 'contract_signed' }, admin_only: false, created_at: iso(2) },
      { id: 'mb', session_id: 'sb', sender_type: 'user', message_type: 'text', content: '문의', action_payload: null, admin_only: false, created_at: iso(3) },
    ]
    expect((await (await call()).json()).count).toBe(2)
    const after = await (await call(`?exclude=${evId},mb,not-a-uuid`)).json()
    expect(after.count).toBe(1)
    expect(after.items[0].message_id).toBe('mb')
  })

  it('자동응답이 마지막이어도 사람 응대 없는 세션의 긴급 고객 문의는 유지, 일반 문의는 제외', async () => {
    state.sessions = [
      { id: 'sa', user_id: 'u0', status: 'open', updated_at: iso(1), admin_id: null },
      { id: 'sb', user_id: 'u0', status: 'open', updated_at: iso(1), admin_id: null },
    ]
    state.messages = [
      { id: 'a2', session_id: 'sa', sender_type: 'admin', message_type: 'text', content: '자동답변', action_payload: null, admin_only: false, created_at: iso(1) },
      { id: 'a1', session_id: 'sa', sender_type: 'user', message_type: 'text', content: '파손됐어요', action_payload: null, admin_only: false, created_at: iso(2) },
      { id: 'b2', session_id: 'sb', sender_type: 'admin', message_type: 'text', content: '자동답변', action_payload: null, admin_only: false, created_at: iso(3) },
      { id: 'b1', session_id: 'sb', sender_type: 'user', message_type: 'text', content: '배송 언제?', action_payload: null, admin_only: false, created_at: iso(4) },
    ]
    state.urgentIds = ['a1']
    const body = await (await call()).json()
    expect(body.items.map((i: { message_id: string }) => i.message_id)).toEqual(['a1'])
    expect(body.items[0].urgent).toBe(true)
  })

  it('활성 세션이 없으면 빈 결과', async () => {
    expect(await (await call()).json()).toEqual({ count: 0, items: [] })
  })
})
