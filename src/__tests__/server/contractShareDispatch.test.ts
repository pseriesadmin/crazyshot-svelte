import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 완료 전자계약서 재공유(share-chat) — 채팅카드 + 푸시 + SMS 동시 발송 실제 핸들러 테스트 (2026-10-08)
 * 실제 라우트·SMS 파이프라인(sendCardSms → sendLifecycleSms)을 쓰고 DB·Solapi·푸시 발송만 가짜로 대체한다.
 */

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k', FIREBASE_ADMIN_CLIENT_EMAIL: 'x', FIREBASE_ADMIN_PRIVATE_KEY: 'x' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://t.supabase.co', PUBLIC_FIREBASE_PROJECT_ID: 'p' }))
vi.mock('$env/dynamic/private', () => ({ env: { SOLAPI_API_KEY: 'a', SOLAPI_API_SECRET: 'b', SMS_SENDER_PHONE: '0212345678' } }))
const envModule = vi.hoisted(() => ({ dev: false }))
vi.mock('$app/environment', () => envModule)

const state = vi.hoisted(() => ({
  order: [] as string[],
  role: 'manager' as string | null,
  contract: { id: 'c1', user_id: 'u1', reservation_id: 501 } as Record<string, unknown> | null,
  signedAt: '2026-10-08T00:00:00Z' as string | null,
  sessionError: false,
  messageError: false,
  phone: '010-3333-4444' as string | null,
  withdrawal: 'none',
  dupLog: false,
  chatInserts: [] as Record<string, unknown>[],
  pushCalls: [] as { userId: string; type: string; payload: Record<string, unknown> }[],
  smsLogs: [] as Record<string, unknown>[],
}))

const mockSend = vi.hoisted(() => vi.fn())
vi.mock('solapi', () => ({
  SolapiMessageService: vi.fn().mockImplementation(function () {
    return { send: async (m: unknown) => { state.order.push('sms'); return mockSend(m) } }
  }),
}))
vi.mock('firebase-admin/app', () => ({ cert: vi.fn(), getApps: () => [], initializeApp: vi.fn() }))
vi.mock('firebase-admin/messaging', () => ({ getMessaging: () => ({}) }))
vi.mock('$lib/server/crazychat/action', () => ({ AGENT_REQUEST_KIND_LABEL: {} }))
vi.mock('$lib/server/adminPushMenuFilter', () => ({ filterAdminPushRecipientsByMenu: async (_c: unknown, _k: string, ids: string[]) => ids }))
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: vi.fn(async () => null) }))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: vi.fn(async () => state.role) }))
vi.mock('$lib/server/push', async (orig) => {
  const real = await orig<typeof import('$lib/server/push')>()
  return {
    ...real,
    sendPushToUser: vi.fn(async (userId: string, type: string, payload: Record<string, unknown>) => {
      state.order.push('push'); state.pushCalls.push({ userId, type, payload })
      return { delivered: false, reason: 'no_token' }
    }),
  }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: async () => (state.sessionError ? { data: null, error: { message: 'x' } } : { data: 'session-1', error: null }),
    from: (table: string) => {
      let cols = ''
      const b: Record<string, unknown> = {}
      b.select = (c: string) => { cols = c; return b }
      for (const m of ['eq', 'in', 'is', 'limit', 'gte', 'lte', 'order']) b[m] = () => b
      const one = async () => {
        if (table === 'contracts') return { data: state.contract, error: null }
        if (table === 'contract_signings') return { data: { signed_at: state.signedAt }, error: null }
        if (table === 'rental_reservations') return { data: { products: { name: '소니 FX3', parent_product_id: null } }, error: null }
        if (table === 'user_profiles' && cols.includes('withdrawal_status')) return { data: { withdrawal_status: state.withdrawal }, error: null }
        if (table === 'user_profiles') return { data: { phone: state.phone }, error: null }
        if (table === 'sms_notification_logs') return { data: state.dupLog ? { id: 1 } : null, error: null }
        return { data: null, error: null }
      }
      b.maybeSingle = one
      b.single = one
      b.insert = async (row: Record<string, unknown>) => {
        if (table === 'chat_messages') {
          state.order.push('chat')
          if (state.messageError) return { error: { message: 'x' } }
          state.chatInserts.push(row)
        }
        if (table === 'sms_notification_logs') state.smsLogs.push(row)
        return { error: null }
      }
      return b
    },
  }),
}))

import { POST } from '../../routes/api/cms/contracts/[id]/share-chat/+server'

const call = () => POST({ params: { id: 'c1' }, locals: {} } as never)

beforeEach(() => {
  vi.clearAllMocks()
  envModule.dev = false
  mockSend.mockResolvedValue({ failedMessageList: [] })
  Object.assign(state, {
    order: [], role: 'manager', sessionError: false, messageError: false, phone: '010-3333-4444', withdrawal: 'none', dupLog: false,
    chatInserts: [], pushCalls: [], smsLogs: [], signedAt: '2026-10-08T00:00:00Z',
    contract: { id: 'c1', user_id: 'u1', reservation_id: 501 },
  })
})

describe('POST share-chat — 완료 계약서 재공유 시 채팅카드 + 푸시 + SMS 동시 발송', () => {
  it('채팅카드(contract_signed) → 푸시 → SMS 순서로 한 요청에서 모두 나가고, SMS에는 고객 계약서 화면 링크가 들어간다', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(state.chatInserts).toHaveLength(1)
    expect(state.chatInserts[0]).toMatchObject({ sender_type: 'admin', message_type: 'action_card', action_payload: { type: 'contract_signed', contract_id: 'c1' } })
    expect(state.pushCalls).toEqual([{ userId: 'u1', type: 'contract_signed_customer', payload: expect.objectContaining({ link: '/account/rental/501/contract' }) }])
    expect(mockSend).toHaveBeenCalledTimes(1)
    const sms = mockSend.mock.calls[0][0] as { to: string; text: string }
    expect(sms.to).toBe('01033334444')
    expect(sms.text).toContain('[크레이지샷] 소니 FX3 전자계약서를 다시 확인해주세요.')
    expect(sms.text).toContain('https://crazyshot.kr/account/rental/501/contract')
    expect(sms.text).not.toContain('서명이 완료됐어요')
    expect(state.order).toEqual(['chat', 'push', 'sms'])
    expect(state.smsLogs.filter((l) => l.status === 'sent' && l.notify_type === 'contract_reshare')).toHaveLength(1)
  })

  it('같은 날 이미 같은 SMS 기록이 있어도 관리자의 재공유는 다시 발송한다(force)', async () => {
    state.dupLog = true
    await call()
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it('연속으로 두 번 재공유하면 채팅·푸시·SMS가 매번 나간다', async () => {
    await call()
    await call()
    expect(state.chatInserts).toHaveLength(2)
    expect(state.pushCalls).toHaveLength(2)
    expect(mockSend).toHaveBeenCalledTimes(2)
  })

  it('채팅 세션 생성·메시지 저장에 실패하면 500이고 푸시·SMS는 나가지 않는다', async () => {
    state.sessionError = true
    expect((await call()).status).toBe(500)
    state.sessionError = false
    state.messageError = true
    expect((await call()).status).toBe(500)
    expect(state.pushCalls).toHaveLength(0)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('SMS 업체가 실패해도 재공유 요청은 성공하고 채팅·푸시는 보존되며 실패 로그가 남는다', async () => {
    mockSend.mockRejectedValue(new Error('solapi down'))
    const res = await call()
    expect(res.status).toBe(200)
    expect(state.chatInserts).toHaveLength(1)
    expect(state.pushCalls).toHaveLength(1)
    expect(state.smsLogs.some((l) => l.status === 'failed')).toBe(true)
  })

  it('전화번호가 없거나 탈퇴 상태이거나 개발 환경이면 채팅·푸시만 나가고 SMS는 건너뛴다', async () => {
    state.phone = null
    await call()
    state.phone = '010-3333-4444'
    for (const w of ['requested', 'purged']) { state.withdrawal = w; await call() }
    state.withdrawal = 'none'
    envModule.dev = true
    await call()
    expect(state.chatInserts).toHaveLength(4)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('서명이 완료되지 않은 계약서는 400 — 어떤 알림도 나가지 않는다', async () => {
    state.signedAt = null
    expect((await call()).status).toBe(400)
    expect(state.chatInserts).toHaveLength(0)
    expect(state.pushCalls).toHaveLength(0)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('고객 정보가 없으면 400, 계약서가 없으면 404, 매니저 미만은 403 — 어떤 알림도 나가지 않는다', async () => {
    state.contract = { id: 'c1', user_id: null, reservation_id: 501 }
    expect((await call()).status).toBe(400)
    state.contract = null
    expect((await call()).status).toBe(404)
    state.contract = { id: 'c1', user_id: 'u1', reservation_id: 501 }
    state.role = 'partner'
    expect((await call()).status).toBe(403)
    expect(state.chatInserts).toHaveLength(0)
    expect(state.pushCalls).toHaveLength(0)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('예약 연결이 없는 계약은 고객 계약 목록 링크로 푸시하고 SMS는 건너뛴다(예약 없이 상품명을 알 수 없음)', async () => {
    state.contract = { id: 'c1', user_id: 'u1', reservation_id: null }
    await call()
    expect(state.pushCalls[0].payload).toMatchObject({ link: '/account/rental' })
    expect(mockSend).not.toHaveBeenCalled()
  })
})
