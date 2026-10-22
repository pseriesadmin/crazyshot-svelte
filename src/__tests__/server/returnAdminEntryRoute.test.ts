import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  denied: null as Response | null,
  role: 'partner' as string | null,
  session: true,
  rsv: { status: 'in_use' } as { status: string } | null,
  filesOk: true,
  insertOk: true,
  rpcOk: true,
  inserted: 0,
  deleted: 0,
  rpcCalls: [] as string[],
}))

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://proj.supabase.co' }))
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: vi.fn(async () => state.denied) }))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: vi.fn(async () => state.role) }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (t: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: t === 'rental_reservations' ? state.rsv : null }) }),
      }),
      insert: () => ({
        select: () => ({ single: async () => { if (state.insertOk) state.inserted++; return state.insertOk ? { data: { id: 9 }, error: null } : { data: null, error: { message: 'x' } } } }),
      }),
      delete: () => ({ eq: async () => { state.deleted++; return { error: null } } }),
    }),
    storage: { from: () => ({ createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => (state.filesOk ? { path: p, signedUrl: 'u' } : { path: p, signedUrl: null, error: 'nf' })), error: null }) }) },
    rpc: async (name: string) => { state.rpcCalls.push(name); return name === 'update_reservation_status' ? (state.rpcOk ? { data: { ok: true }, error: null } : { data: { ok: false, error: 'fail' }, error: null }) : { data: null, error: null } },
  }),
}))

import { POST } from '../../routes/api/cms/reservations/[id]/return-entries/+server'

const UUID = '123e4567-e89b-12d3-a456-426614174000'
const goodBody = { memo: '정상 반납', checklist: ['body'], media: [{ path: `5/admin/${UUID}.jpg`, kind: 'photo' }] }
const call = (body: unknown = goodBody, id = '5') =>
  POST({
    params: { id },
    request: new Request('http://x', { method: 'POST', body: JSON.stringify(body) }),
    locals: { safeGetSession: async () => ({ session: state.session ? { user: { id: 'u1' } } : null }) },
  } as never)

beforeEach(() => {
  state.denied = null; state.role = 'partner'; state.session = true
  state.rsv = { status: 'in_use' }
  state.filesOk = true; state.insertOk = true; state.rpcOk = true
  state.inserted = 0; state.deleted = 0; state.rpcCalls = []
})

describe('POST /api/cms/reservations/[id]/return-entries — 반납정보 관리자 등록', () => {
  it('메뉴 권한·CMS 직원·세션이 없으면 저장하지 않는다', async () => {
    state.denied = new Response('no', { status: 403 })
    expect((await call()).status).toBe(403)
    state.denied = null; state.role = null
    expect((await call()).status).toBe(401)
    state.role = 'partner'; state.session = false
    expect((await call()).status).toBe(401)
    expect(state.inserted).toBe(0)
  })

  it('등록 불가 상태(계약완료·취소·완료)면 409, 예약이 없으면 404 — 반납 방식은 묻지 않는다', async () => {
    for (const status of ['confirmed', 'cancelled', 'completed']) {
      state.rsv = { status }
      expect((await call()).status).toBe(409)
    }
    state.rsv = null
    expect((await call()).status).toBe(404)
    expect(state.inserted).toBe(0)
  })

  it('본문이 잘못되면(타 예약 경로) 400 이고 저장하지 않는다', async () => {
    const r = await call({ media: [{ path: `6/admin/${UUID}.jpg`, kind: 'photo' }] })
    expect(r.status).toBe(400)
    expect(state.inserted).toBe(0)
  })

  it('업로드 파일이 저장소에 없으면 400 이다', async () => {
    state.filesOk = false
    expect((await call()).status).toBe(400)
    expect(state.inserted).toBe(0)
  })

  it('대여중 등록은 반납중으로 전환하고 로그를 남긴다', async () => {
    const r = await call()
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ ok: true, status: 'return_requested' })
    expect(state.rpcCalls).toEqual(['update_reservation_status', 'log_rental_action'])
  })

  it('반납요청·반납완료 등록은 상태를 바꾸지 않는다', async () => {
    for (const status of ['return_requested', 'returned']) {
      state.rsv = { status }
      state.rpcCalls = []
      const r = await call()
      expect(r.status).toBe(200)
      expect(await r.json()).toMatchObject({ status })
      expect(state.rpcCalls).not.toContain('update_reservation_status')
    }
  })

  it('상태 전환이 실패하면 방금 만든 등록을 지우고 500 을 돌려준다', async () => {
    state.rpcOk = false
    const r = await call()
    expect(r.status).toBe(500)
    expect(state.inserted).toBe(1)
    expect(state.deleted).toBe(1)
  })

  it('저장 실패는 500 이고 상태 전환을 시도하지 않는다', async () => {
    state.insertOk = false
    expect((await call()).status).toBe(500)
    expect(state.rpcCalls).toEqual([])
  })
})
