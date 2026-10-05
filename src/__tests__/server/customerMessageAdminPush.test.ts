import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 고객 상담 메시지 도착 관리자 푸시(2026-10-05) — 최근 10분 내 대화가 없던 세션에서만 new_session 플래그로 발송.
 */
vi.mock('$env/static/private', () => ({
  FIREBASE_ADMIN_CLIENT_EMAIL: 'x', FIREBASE_ADMIN_PRIVATE_KEY: 'x', SUPABASE_SERVICE_ROLE_KEY: 'k',
}))
vi.mock('$env/static/public', () => ({ PUBLIC_FIREBASE_PROJECT_ID: 'p', PUBLIC_SUPABASE_URL: 'https://t.supabase.co' }))
vi.mock('firebase-admin/app', () => ({ cert: vi.fn(), getApps: () => [], initializeApp: vi.fn() }))
vi.mock('firebase-admin/messaging', () => ({ getMessaging: vi.fn() }))
vi.mock('$lib/server/sms', () => ({ sendLifecycleSms: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))

const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
vi.mock('$lib/utils/rpc', () => ({
  callTypedRpc: async (_c: unknown, name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args })
    return { data: [], error: null } // 수신자 없음 → 발송 단계 전에 종료
  },
}))

function fakeAdmin(recent: Array<{ id: string }>, fullName = '홍길동') {
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      Object.assign(chain, {
        select: () => chain, eq: () => chain, neq: () => chain, gte: () => chain,
        limit: async () => ({ data: recent, error: null }),
        maybeSingle: async () => ({ data: table === 'user_profiles' ? { full_name: fullName } : null, error: null }),
      })
      return chain
    },
  } as never
}

beforeEach(() => { rpcCalls.length = 0 })

describe('sendCustomerMessageAdminPush', () => {
  it('최근 10분 내 메시지가 없으면 new_session 이벤트로 관리자 푸시를 시도한다', async () => {
    const { sendCustomerMessageAdminPush } = await import('../../lib/server/push')
    await sendCustomerMessageAdminPush(fakeAdmin([]), 's1', 'u1', 'm1', '대여 문의드려요')
    expect(rpcCalls).toEqual([{ name: 'get_admin_push_recipients', args: { p_event_key: 'new_session' } }])
  })

  it('최근 10분 내 메시지가 있으면(진행 중인 대화) 푸시하지 않는다', async () => {
    const { sendCustomerMessageAdminPush } = await import('../../lib/server/push')
    await sendCustomerMessageAdminPush(fakeAdmin([{ id: 'prev' }]), 's1', 'u1', 'm1', '또 문의')
    expect(rpcCalls).toHaveLength(0)
  })

  it('조회 중 예외가 나도 throw하지 않는다(메시지 저장은 이미 완료)', async () => {
    const { sendCustomerMessageAdminPush } = await import('../../lib/server/push')
    const broken = { from: () => { throw new Error('db down') } } as never
    await expect(sendCustomerMessageAdminPush(broken, 's1', 'u1', 'm1', 'x')).resolves.toBeUndefined()
  })
})
