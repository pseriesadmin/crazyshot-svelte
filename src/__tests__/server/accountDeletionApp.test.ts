import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 회원 삭제·탈퇴 통합 — 앱 계층 단위 테스트 (2026-10-24, Migration #763·#764)
 *  · 보존 만료 크론: 인증 실패 거부, 새 만료 없음/있음(알림 기록 + 매니저 푸시, 자동 삭제 없음)
 *  · 저장소 정리 크론: 파일 삭제 후 완료 표시, 실패 시 시도 횟수만 증가
 *  · 루트 레이아웃: 본인 탈퇴 복구 → withdrawalRestored, 관리자 삭제 계정 → 로그아웃 + accountNotice
 */

const env = { CRON_SECRET: 'sec', SUPABASE_SERVICE_ROLE_KEY: 'k' } as Record<string, string | undefined>
vi.mock('$env/dynamic/private', () => ({ env }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://test.supabase.co' }))

const pushToManagers = vi.fn(async (..._a: unknown[]) => undefined)
vi.mock('$lib/server/push', () => ({ sendPushToManagers: (...a: unknown[]) => pushToManagers(...a) }))

// ── supabase 모의: rpc / from(...) 체인 ──
const rpcImpl = vi.fn()
const upsertImpl = vi.fn(async (..._a: unknown[]) => ({ error: null }))
const updateEq = vi.fn(async (..._a: unknown[]) => ({ error: null }))
let jobs: unknown[] = []
let failedEvents: { user_id: string }[] = []
const storageList = vi.fn()
const storageRemove = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (...a: unknown[]) => rpcImpl(...a),
    from: (table: string) => {
      if (table === 'retention_expiry_alerts') return { upsert: (...a: unknown[]) => upsertImpl(...a) }
      if (table === 'account_deletion_events') return { select: () => ({ eq: () => ({ gte: async () => ({ data: failedEvents, error: null }) }) }) }
      // account_storage_cleanup
      return {
        select: () => ({ is: () => ({ lt: () => ({ order: () => ({ limit: async () => ({ data: jobs, error: null }) }) }) }) }),
        update: (row: unknown) => ({ eq: (...a: unknown[]) => { void updateEq(row, ...a); return Promise.resolve({ error: null }) } }),
      }
    },
    storage: { from: () => ({ list: (...a: unknown[]) => storageList(...a), remove: (...a: unknown[]) => storageRemove(...a) }) },
  }),
}))

const retention = await import('../../routes/api/cron/retention-expiry/+server')
const cleanup = await import('../../routes/api/cron/account-storage-cleanup/+server')

const ev = (auth?: string) => ({ request: new Request('https://t.local/x', { headers: auth ? { authorization: auth } : {} }) }) as never

beforeEach(() => {
  vi.clearAllMocks()
  env.CRON_SECRET = 'sec'
  jobs = []
  failedEvents = []
})

describe('보존 만료 크론 /api/cron/retention-expiry', () => {
  it('시크릿이 없거나 틀리면 401(fail-closed)', async () => {
    env.CRON_SECRET = undefined
    expect((await retention.GET(ev('Bearer sec'))).status).toBe(401)
    env.CRON_SECRET = 'sec'
    expect((await retention.GET(ev())).status).toBe(401)
    expect((await retention.GET(ev('Bearer wrong'))).status).toBe(401)
  })

  it('새로 만료된 건이 없으면 알림·기록 없이 끝난다', async () => {
    rpcImpl.mockResolvedValue({ data: [], error: null })
    const res = await retention.GET(ev('Bearer sec'))
    expect(await res.json()).toEqual({ ok: true, newDue: 0, anonymizeFailures: 0 })
    expect(upsertImpl).not.toHaveBeenCalled()
    expect(pushToManagers).not.toHaveBeenCalled()
  })

  it('새로 만료된 건은 알림 기록 후 매니저에게 알린다 — 삭제 호출은 없다', async () => {
    rpcImpl.mockResolvedValue({ data: [{ user_id: 'u1', kind: 'transaction' }, { user_id: 'u2', kind: 'chat' }], error: null })
    const res = await retention.GET(ev('Bearer sec'))
    expect(await res.json()).toMatchObject({ ok: true, newDue: 2, transaction: 1, chat: 1 })
    expect(upsertImpl).toHaveBeenCalledTimes(1)
    expect(pushToManagers).toHaveBeenCalledWith('retention_expiry', expect.objectContaining({ link: '/cms/set/retention' }))
    // 호출한 RPC는 도래 조회뿐(삭제·파기 RPC 없음)
    expect(rpcImpl.mock.calls.map((c) => c[0])).toEqual(['cms_retention_new_due'])
  })

  it('익명 전환 실패 기록이 있으면 새 만료가 없어도 매니저에게 알린다', async () => {
    rpcImpl.mockResolvedValue({ data: [], error: null })
    failedEvents = [{ user_id: 'u1' }, { user_id: 'u1' }, { user_id: 'u2' }]
    const res = await retention.GET(ev('Bearer sec'))
    expect(await res.json()).toEqual({ ok: true, newDue: 0, anonymizeFailures: 2 })
    expect(pushToManagers).toHaveBeenCalledWith('retention_expiry', expect.objectContaining({ title: '익명 전환에 실패한 계정이 있어요' }))
  })

  it('알림 기록 실패 시 500(같은 건을 반복 알리지 않기 위해 푸시 전에 중단)', async () => {
    rpcImpl.mockResolvedValue({ data: [{ user_id: 'u1', kind: 'transaction' }], error: null })
    upsertImpl.mockResolvedValueOnce({ error: { message: 'x' } } as never)
    expect((await retention.GET(ev('Bearer sec'))).status).toBe(500)
    expect(pushToManagers).not.toHaveBeenCalled()
  })
})

describe('저장소 정리 크론 /api/cron/account-storage-cleanup', () => {
  it('시크릿 없으면 401', async () => {
    expect((await cleanup.GET(ev())).status).toBe(401)
  })

  it('계정 폴더 파일을 삭제하고 완료로 표시한다', async () => {
    jobs = [{ id: 1, user_id: 'u1', bucket: 'user-documents', prefix: 'u1/', attempts: 0 }]
    storageList.mockResolvedValue({ data: [{ name: 'identity_a.png' }, { name: 'foreign_b.pdf' }], error: null })
    storageRemove.mockResolvedValue({ error: null })
    const res = await cleanup.GET(ev('Bearer sec'))
    expect(await res.json()).toMatchObject({ ok: true, done: 1, failed: 0 })
    expect(storageRemove).toHaveBeenCalledWith(['u1/identity_a.png', 'u1/foreign_b.pdf'])
    const row = updateEq.mock.calls[0][0] as { done_at?: string }
    expect(typeof row.done_at).toBe('string')
  })

  it('파일이 없어도 완료로 표시한다(삭제 호출 없음)', async () => {
    jobs = [{ id: 2, user_id: 'u2', bucket: 'user-avatars', prefix: 'u2/', attempts: 0 }]
    storageList.mockResolvedValue({ data: [], error: null })
    await cleanup.GET(ev('Bearer sec'))
    expect(storageRemove).not.toHaveBeenCalled()
    expect((updateEq.mock.calls[0][0] as { done_at?: string }).done_at).toBeTruthy()
  })

  it('삭제 실패 시 완료로 표시하지 않고 시도 횟수만 올린다', async () => {
    jobs = [{ id: 3, user_id: 'u3', bucket: 'user-documents', prefix: 'u3/', attempts: 1 }]
    storageList.mockResolvedValue({ data: [{ name: 'a.png' }], error: null })
    storageRemove.mockResolvedValue({ error: { message: 'boom' } })
    const res = await cleanup.GET(ev('Bearer sec'))
    expect(await res.json()).toMatchObject({ done: 0, failed: 1 })
    expect(updateEq.mock.calls[0][0]).toEqual({ attempts: 2 })
  })
})
