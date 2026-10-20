// csRecordPatchApi.test.ts — PATCH /api/chat/sessions/[id]/cs-record?id= : 상담 메모 1건 수정(단문 100자·빈 값 거절·세션 조건·404)
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  denied: null as Response | null,
  session: { user: { id: 'adm1', email: 'a@x.kr' } } as unknown,
  role: 'manager' as string | null,
  updated: null as unknown,
  updateResult: { id: 'm1', session_id: 's1', summary: '수정됨', updated_at: 'now' } as unknown,
  updateError: null as { message: string } | null,
  captured: { values: null as unknown, filters: [] as Array<[string, unknown]> },
}))

vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'test' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'http://localhost' }))
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: async () => state.denied }))
vi.mock('$lib/server/crossLingualSynonymScan', () => ({ registerCrossLingualCandidates: async () => undefined }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      const chain: Record<string, unknown> = {}
      const proxy: unknown = new Proxy(chain, {
        get(_t, prop: string) {
          if (prop === 'then') return undefined
          if (prop === 'single') return async () => ({ data: { cms_role: state.role }, error: null })
          if (prop === 'maybeSingle') return async () => ({ data: state.updateResult, error: state.updateError })
          if (prop === 'update') return (v: unknown) => { state.captured.values = v; return proxy }
          if (prop === 'eq') return (k: string, v: unknown) => { state.captured.filters.push([k, v]); return proxy }
          return () => proxy
        },
      })
      return table === 'user_profiles' || table === 'cs_records' ? proxy : proxy
    },
  }),
}))

import { PATCH } from '../../routes/api/chat/sessions/[id]/cs-record/+server'

function call(qs: string, body: unknown) {
  return PATCH({
    params: { id: 's1' },
    url: new URL(`http://localhost/api/chat/sessions/s1/cs-record${qs}`),
    request: new Request('http://localhost', { method: 'PATCH', body: JSON.stringify(body) }),
    locals: { safeGetSession: async () => ({ session: state.session }) },
  } as unknown as Parameters<typeof PATCH>[0])
}

beforeEach(() => {
  state.denied = null; state.session = { user: { id: 'adm1', email: 'a@x.kr' } }; state.role = 'manager'
  state.updateResult = { id: 'm1', session_id: 's1', summary: '수정됨', updated_at: 'now' }; state.updateError = null
  state.captured = { values: null, filters: [] }
})

describe('PATCH cs-record', () => {
  it('상담 메뉴 권한이 없으면 가드 응답 그대로', async () => {
    state.denied = new Response('{}', { status: 403 })
    expect((await call('?id=m1', { summary: 'x' })).status).toBe(403)
  })
  it('로그인 없으면 401, CMS 역할 없으면 403', async () => {
    state.session = null
    expect((await call('?id=m1', { summary: 'x' })).status).toBe(401)
    state.session = { user: { id: 'a' } }; state.role = null
    expect((await call('?id=m1', { summary: 'x' })).status).toBe(403)
  })
  it('메모 id가 없으면 400', async () => {
    expect((await call('', { summary: '내용' })).status).toBe(400)
  })
  it('빈 내용·100자 초과는 400(서버가 최종 검증)', async () => {
    expect((await call('?id=m1', { summary: '   ' })).status).toBe(400)
    expect((await call('?id=m1', { summary: '가'.repeat(101) })).status).toBe(400)
  })
  it('정상 수정: 공백·줄바꿈을 정리해 저장하고, id와 session_id를 함께 조건으로 건다', async () => {
    const res = await call('?id=m1', { summary: '  수정된\n 내용  ' })
    expect(res.status).toBe(200)
    expect((state.captured.values as { summary: string }).summary).toBe('수정된 내용')
    expect(state.captured.filters).toEqual(expect.arrayContaining([['id', 'm1'], ['session_id', 's1']]))
    expect((await res.json()).record.summary).toBe('수정됨')
  })
  it('다른 세션 메모이거나 없으면 404', async () => {
    state.updateResult = null
    expect((await call('?id=zzz', { summary: '내용' })).status).toBe(404)
  })
  it('DB 오류는 500', async () => {
    state.updateResult = null; state.updateError = { message: 'boom' }
    expect((await call('?id=m1', { summary: '내용' })).status).toBe(500)
  })
})
