// cmsMergeGuestApi.test.ts — 관리자 수동 비회원 병합: /api/cms/chat/merge-guest (POST) · /search (GET)
// 정상: 매니저 이상이 비회원 세션 + 회원을 지정하면 DB 병합 함수를 그 세션의 user_id·선택 회원 id로만 호출하고 회원 쪽 세션 id를 돌려준다.
// 막을 것: 권한 없음(401/403)·잘못된 id(400)·없는 세션/회원(404)·DB 거절 사유 문구 변환·내부 오류 상세 비노출·검색어 필터 구조 주입.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@sveltejs/kit', () => ({ json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }) }))
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'svc' } }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))

const mockMenuDenied = vi.fn()
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: (...a: unknown[]) => mockMenuDenied(...a) }))
const mockRole = vi.fn()
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: (...a: unknown[]) => mockRole(...a) }))

let sessionRow: { data: unknown; error: { message: string } | null } = { data: null, error: null }
let memberRow: { data: unknown; error: { message: string } | null } = { data: null, error: null }
let targetRow: { data: unknown } = { data: null }
let searchResult: { data: unknown; error: { message: string } | null } = { data: [], error: null }
const orCalls: string[] = []
const mockRpc = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: mockRpc,
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'order', 'limit']) chain[m] = () => chain
      chain.or = (f: string) => { orCalls.push(f); return chain }
      chain.maybeSingle = async () => {
        if (table === 'chat_sessions') return targetCall++ === 0 ? sessionRow : targetRow
        return memberRow
      }
      // 검색(.limit 이후 await) — user_profiles 목록 조회
      chain.then = (r: (v: unknown) => unknown) => Promise.resolve(searchResult).then(r)
      return chain
    },
  }),
}))
let targetCall = 0

const { POST } = await import('../../routes/api/cms/chat/merge-guest/+server')
const { GET } = await import('../../routes/api/cms/chat/merge-guest/search/+server')

const SID = '11111111-1111-4111-8111-111111111111'
const MID = '22222222-2222-4222-8222-222222222222'
const GID = '33333333-3333-4333-8333-333333333333'

function post(body: unknown) {
  return POST({ locals: {}, request: { json: async () => body } } as unknown as Parameters<typeof POST>[0]) as unknown as Promise<{ status: number; data: Record<string, unknown> }>
}
function search(q: string) {
  return GET({ locals: {}, url: new URL(`http://x/api?q=${encodeURIComponent(q)}`) } as unknown as Parameters<typeof GET>[0]) as unknown as Promise<{ status: number; data: Record<string, unknown> }>
}

beforeEach(() => {
  vi.clearAllMocks()
  targetCall = 0
  orCalls.length = 0
  mockMenuDenied.mockResolvedValue(null)
  mockRole.mockResolvedValue('manager')
  sessionRow = { data: { id: SID, user_id: GID }, error: null }
  memberRow = { data: { id: MID, deleted_at: null }, error: null }
  targetRow = { data: { id: 'member-session-1' } }
  searchResult = { data: [], error: null }
})

describe('POST /api/cms/chat/merge-guest', () => {
  it('메뉴 권한이 없으면 그 응답을 그대로 돌려주고 병합하지 않는다', async () => {
    mockMenuDenied.mockResolvedValue({ status: 403, data: { error: 'denied' } })
    expect((await post({ session_id: SID, member_id: MID })).status).toBe(403)
    expect(mockRpc).not.toHaveBeenCalled()
  })
  it('CMS 역할이 없으면 401, 파트너(매니저 미만)는 403', async () => {
    mockRole.mockResolvedValue(null)
    expect((await post({ session_id: SID, member_id: MID })).status).toBe(401)
    mockRole.mockResolvedValue('partner')
    expect((await post({ session_id: SID, member_id: MID })).status).toBe(403)
    expect(mockRpc).not.toHaveBeenCalled()
  })
  it('id 형식이 잘못되면 400', async () => {
    expect((await post({ session_id: 'x', member_id: MID })).status).toBe(400)
    expect((await post({ session_id: SID })).status).toBe(400)
    expect((await post(null)).status).toBe(400)
    expect(mockRpc).not.toHaveBeenCalled()
  })
  it('세션이 없으면 404', async () => {
    sessionRow = { data: null, error: null }
    expect((await post({ session_id: SID, member_id: MID })).status).toBe(404)
    expect(mockRpc).not.toHaveBeenCalled()
  })
  it('회원이 없거나 삭제된 계정이면 404', async () => {
    memberRow = { data: null, error: null }
    expect((await post({ session_id: SID, member_id: MID })).status).toBe(404)
    memberRow = { data: { id: MID, deleted_at: '2026-11-01' }, error: null }
    expect((await post({ session_id: SID, member_id: MID })).status).toBe(404)
    expect(mockRpc).not.toHaveBeenCalled()
  })
  it('정상: 세션의 user_id(비회원)와 선택한 회원 id로만 DB 함수를 호출하고 회원 세션 id를 돌려준다', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true, sessions: 1, messages: 9 }, error: null })
    const res = await post({ session_id: SID, member_id: MID })
    expect(res.status).toBe(200)
    expect(res.data).toMatchObject({ ok: true, sessions: 1, messages: 9, member_session_id: 'member-session-1' })
    expect(mockRpc).toHaveBeenCalledWith('merge_guest_chat_into_member', { p_guest_id: GID, p_member_id: MID })
  })
  it('DB가 비회원이 아니라고 거절하면 400과 안내 문구', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'GUEST_NOT_ANONYMOUS' } })
    const res = await post({ session_id: SID, member_id: MID })
    expect(res.status).toBe(400)
    expect(res.data.error).toBe('비회원 상담만 병합할 수 있습니다.')
  })
  it('알 수 없는 DB 오류는 500이며 상세를 노출하지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockRpc.mockResolvedValue({ data: null, error: { message: 'secret detail' } })
    const res = await post({ session_id: SID, member_id: MID })
    expect(res.status).toBe(500)
    expect(JSON.stringify(res.data)).not.toContain('secret detail')
    spy.mockRestore()
  })
})

describe('GET /api/cms/chat/merge-guest/search', () => {
  it('권한 검사: 메뉴 거부·역할 없음·파트너는 조회하지 않는다', async () => {
    mockMenuDenied.mockResolvedValue({ status: 403, data: {} })
    expect((await search('홍길동')).status).toBe(403)
    mockMenuDenied.mockResolvedValue(null)
    mockRole.mockResolvedValue(null)
    expect((await search('홍길동')).status).toBe(401)
    mockRole.mockResolvedValue('partner')
    expect((await search('홍길동')).status).toBe(403)
    expect(orCalls).toHaveLength(0)
  })
  it('검색어가 2자 미만이면 DB를 조회하지 않고 빈 목록', async () => {
    const res = await search('a')
    expect(res.data).toEqual({ members: [] })
    expect(orCalls).toHaveLength(0)
  })
  it('필터 구문·와일드카드 문자는 제거해 조회한다', async () => {
    searchResult = { data: [{ id: MID, email: 'a@b.c', full_name: '임태령', member_code: 'CSBC2611004' }], error: null }
    const res = await search('a@b.c),id.neq.0,(%_')
    expect(res.status).toBe(200)
    expect(orCalls).toHaveLength(1)
    // 정상 필터는 이메일·회원코드·이름 3조건뿐 — 주입한 ", id.neq.0" 가 별도 조건으로 늘어나면 안 된다
    expect(orCalls[0].split(',')).toHaveLength(3)
    expect(orCalls[0]).not.toContain(')')
    expect((res.data.members as unknown[]).length).toBe(1)
  })
  it('DB 오류는 500(상세 미노출)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    searchResult = { data: null, error: { message: 'secret detail' } }
    const res = await search('홍길동')
    expect(res.status).toBe(500)
    expect(JSON.stringify(res.data)).not.toContain('secret detail')
    spy.mockRestore()
  })
})
