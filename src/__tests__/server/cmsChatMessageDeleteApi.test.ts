// cmsChatMessageDeleteApi.test.ts — DELETE /api/cms/chat/messages/[id]: 권한 가드·id 검증·DB 오류 매핑
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  denied: null as Response | null,
  session: { user: { id: 'adm1' } } as unknown,
  role: 'manager' as string | null,
  rpcResult: { data: { ok: true }, error: null } as { data: unknown; error: { message: string } | null },
  rpcArgs: null as unknown,
}))

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'test' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'http://localhost' }))
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: async () => state.denied }))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: async () => state.role }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: async (_fn: string, args: unknown) => { state.rpcArgs = args; return state.rpcResult },
  }),
}))

import { DELETE } from '../../routes/api/cms/chat/messages/[id]/+server'

const ID = '11111111-1111-4111-8111-111111111111'
const call = (id = ID) => DELETE({
  params: { id },
  locals: { safeGetSession: async () => ({ session: state.session }) },
} as unknown as Parameters<typeof DELETE>[0])

beforeEach(() => {
  state.denied = null; state.session = { user: { id: 'adm1' } }; state.role = 'manager'
  state.rpcResult = { data: { ok: true }, error: null }; state.rpcArgs = null
})

describe('DELETE /api/cms/chat/messages/[id]', () => {
  it('상담 메뉴 권한이 없으면 가드 응답 그대로', async () => {
    state.denied = new Response('{}', { status: 403 })
    expect((await call()).status).toBe(403)
  })
  it('로그인 없으면 401, CMS 역할 없으면 403', async () => {
    state.session = null
    expect((await call()).status).toBe(401)
    state.session = { user: { id: 'a' } }; state.role = null
    expect((await call()).status).toBe(403)
  })
  it('id 형식이 잘못되면 400(DB 호출 안 함)', async () => {
    expect((await call('not-a-uuid')).status).toBe(400)
    expect(state.rpcArgs).toBeNull()
  })
  it('정상 삭제: 메시지 id와 관리자 id를 함께 DB 함수에 넘긴다', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(state.rpcArgs).toEqual({ p_message_id: ID, p_admin_id: 'adm1' })
  })
  it('막힌 카드·고객 메시지·이미 삭제·없음은 각각 409·403·409·404', async () => {
    const cases: Array<[string, number]> = [
      ['CARD_TYPE_NOT_DELETABLE:contract_link', 409],
      ['CUSTOMER_MESSAGE_NOT_DELETABLE', 403],
      ['ALREADY_DELETED', 409],
      ['MESSAGE_NOT_FOUND', 404],
    ]
    for (const [code, status] of cases) {
      state.rpcResult = { data: null, error: { message: code } }
      expect((await call()).status).toBe(status)
    }
  })
  it('그 외 DB 오류는 500', async () => {
    state.rpcResult = { data: null, error: { message: 'boom' } }
    expect((await call()).status).toBe(500)
  })
})
