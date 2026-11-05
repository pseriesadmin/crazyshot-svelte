// chatSessionCreateApi.test.ts — POST /api/chat/session: 고객당 일반 대화 1개(예약 상담 요청도 일반으로, 열린 대화는 재사용)
import { describe, it, expect, vi, beforeEach } from 'vitest'

const pushMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('@sveltejs/kit', () => ({ json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }) }))
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'svc' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://test.supabase.co' }))
vi.mock('$lib/server/push', () => ({ sendNewChatSessionAdminPush: pushMock }))

let openRow: unknown = null
let closedRow: { id: string } | null = null
let reopenFails = false
const inserted: Array<Record<string, unknown>> = []
const openStatuses: unknown[] = []
const openFilters: Array<Map<string, unknown>> = []
const closedFilters: Array<Map<string, unknown>> = []

function fakeDb() {
  return {
    from: (table: string) => {
      const f = new Map<string, unknown>()
      let isOpenLookup = false
      let isUpdate = false
      const b = {
        select: () => b,
        eq: (k: string, v: unknown) => { f.set(k, v); return b },
        in: (_c: string, v: unknown) => { isOpenLookup = true; openStatuses.push(v); return b },
        order: () => b,
        limit: () => b,
        maybeSingle: async () => {
          if (table !== 'chat_sessions') return { data: null }
          if (isOpenLookup) { openFilters.push(f); return { data: openRow } }
          closedFilters.push(f)
          return { data: closedRow }
        },
        update: () => { isUpdate = true; return b },
        single: async () => {
          if (isUpdate) return reopenFails ? { data: null, error: { message: 'x' } } : { data: { id: closedRow?.id, status: 'open' }, error: null }
          return { data: { id: 'new-1', status: 'open' }, error: null }
        },
        insert: (row: Record<string, unknown>) => { inserted.push(row); return b },
      }
      return b
    },
  }
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeDb() }))

const { POST } = await import('../../routes/api/chat/session/+server')

function call(body: unknown) {
  return POST({
    request: { json: async () => body },
    locals: { safeGetSession: async () => ({ session: { user: { id: 'u1' } } }), supabase: fakeDb() },
  } as unknown as Parameters<typeof POST>[0]) as unknown as Promise<{ status: number; data: Record<string, unknown> }>
}

const UUID = '11111111-2222-3333-4444-555555555555'

beforeEach(() => {
  openRow = null
  closedRow = null
  reopenFails = false
  inserted.length = 0
  openStatuses.length = 0
  openFilters.length = 0
  closedFilters.length = 0
  pushMock.mockClear()
})

describe('POST /api/chat/session', () => {
  it('이미 열린 일반 대화가 있으면 새로 만들지 않고 그대로 돌려주며 새 상담 푸시도 보내지 않는다', async () => {
    openRow = { id: 'open-1', context_type: 'general', status: 'open' }
    const res = await call({ context_type: 'general' })
    expect(res.status).toBe(200)
    expect(res.data.session).toMatchObject({ id: 'open-1' })
    expect(inserted).toHaveLength(0)
    expect(pushMock).not.toHaveBeenCalled()
  })
  it('열린 대화 조회는 진행중·대기 두 상태를 모두 보고 본인 일반 대화로 한정한다', async () => {
    openRow = { id: 'pending-1', context_type: 'general', status: 'pending' }
    const res = await call({ context_type: 'general' })
    expect(res.data.session).toMatchObject({ id: 'pending-1', status: 'pending' })
    expect(openStatuses[0]).toEqual(['open', 'pending'])
    expect(openFilters[0].get('user_id')).toBe('u1')
    expect(openFilters[0].get('context_type')).toBe('general')
  })
  it('예약 상담 요청(옛 화면)도 일반 대화로 바꿔 열린 대화를 재사용한다', async () => {
    openRow = { id: 'open-1', context_type: 'general', status: 'open' }
    const res = await call({ context_type: 'reservation', context_reservation_id: 364 })
    expect(res.data.session).toMatchObject({ id: 'open-1' })
    expect(inserted).toHaveLength(0)
  })
  it('열린 대화가 없고 예약 상담 요청이면 일반 대화로 만들고 예약 번호는 연결하지 않으며 푸시를 보낸다', async () => {
    const res = await call({ context_type: 'reservation', context_id: UUID, context_reservation_id: 364 })
    expect(res.status).toBe(201)
    expect(inserted[0]).toMatchObject({ user_id: 'u1', context_type: 'general', context_id: null, context_reservation_id: null })
    expect(pushMock).toHaveBeenCalledTimes(1)
  })
  it('종료된 일반 대화 조회에도 reservation 조건이 붙지 않는다', async () => {
    await call({ context_type: 'reservation', context_reservation_id: 364 })
    expect(closedFilters[0].get('context_type')).toBe('general')
    expect(closedFilters[0].has('context_reservation_id')).toBe(false)
  })
  it('열린 대화가 없고 종료된 일반 대화가 있으면 새로 만들지 않고 다시 열며 푸시를 보낸다', async () => {
    closedRow = { id: 'closed-1' }
    const res = await call({ context_type: 'general' })
    expect(res.status).toBe(200)
    expect(res.data.session).toMatchObject({ id: 'closed-1', status: 'open' })
    expect(inserted).toHaveLength(0)
    expect(pushMock).toHaveBeenCalledTimes(1)
  })
  it('다시 열기가 실패하면 새 대화를 만든다', async () => {
    closedRow = { id: 'closed-1' }
    reopenFails = true
    const res = await call({ context_type: 'general' })
    expect(res.status).toBe(201)
    expect(inserted).toHaveLength(1)
  })
  it('상품 문의 등 다른 종류는 그대로 통과하고 열린 일반 대화 재사용을 거치지 않는다', async () => {
    openRow = { id: 'open-1', context_type: 'general', status: 'open' }
    const res = await call({ context_type: 'product_inquiry', context_id: UUID })
    expect(res.status).toBe(201)
    expect(openStatuses).toHaveLength(0)
    expect(inserted[0]).toMatchObject({ context_type: 'product_inquiry', context_id: UUID })
  })
  it('유효한 context_id 를 가진 일반 요청은 열린 대화 재사용을 건너뛴다', async () => {
    openRow = { id: 'open-1', context_type: 'general', status: 'open' }
    await call({ context_type: 'general', context_id: UUID })
    expect(openStatuses).toHaveLength(0)
    expect(closedFilters[0].get('context_id')).toBe(UUID)
  })
})
