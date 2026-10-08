import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 전자계약 발행 알림 "채팅카드 + 푸시 + SMS 동시 발송" — send-chat 라우트 전수 테스트 (2026-10-08)
 * 실제 라우트 핸들러와 실제 SMS 파이프라인(sendCardSms → sendLifecycleSms)을 쓰고, DB·Solapi·푸시 발송만 가짜로 대체한다.
 */

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k', FIREBASE_ADMIN_CLIENT_EMAIL: 'x', FIREBASE_ADMIN_PRIVATE_KEY: 'x' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://t.supabase.co', PUBLIC_FIREBASE_PROJECT_ID: 'p' }))
vi.mock('$env/dynamic/private', () => ({ env: { SOLAPI_API_KEY: 'a', SOLAPI_API_SECRET: 'b', SMS_SENDER_PHONE: '0212345678' } }))
const envModule = vi.hoisted(() => ({ dev: false }))
vi.mock('$app/environment', () => envModule)

const state = vi.hoisted(() => ({
  order: [] as string[],
  role: 'manager' as string | null,
  contract: { id: 'c1', user_id: 'u1', reservation_id: 501, content_blocks: [], spreadsheet_document: null, html_document: null, authoring_mode: 'content_blocks' } as Record<string, unknown> | null,
  reservationStatus: 'hold',
  existingSigning: null as { id: string; token: string; signed_at: string | null } | null,
  sessionError: false,
  messageError: false,
  phone: '010-3333-4444' as string | null,
  withdrawal: 'none',
  chatInserts: [] as Record<string, unknown>[],
  pushCalls: [] as { userId: string; type: string; payload: Record<string, unknown> }[],
  smsLogs: [] as Record<string, unknown>[],
  audit: [] as Record<string, unknown>[],
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
vi.mock('$lib/contract-signature/issuerSignatureCheck', () => ({ checkIssuerSignatureRequired: vi.fn(async () => ({ blocked: false })) }))
vi.mock('$lib/contract-signature/auditLog', () => ({ recordAuditLog: vi.fn(async (_a: unknown, p: Record<string, unknown>) => { state.audit.push(p) }) }))
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
    rpc: async () => {
      if (state.sessionError) return { data: null, error: { message: 'x' } }
      return { data: 'session-1', error: null }
    },
    from: (table: string) => {
      const f: Record<string, unknown> = {}
      let cols = ''
      const b: Record<string, unknown> = {}
      b.select = (c: string) => { cols = c; return b }
      b.eq = (k: string, v: unknown) => { f[k] = v; return b }
      for (const m of ['in', 'is', 'limit', 'gte', 'lte', 'order']) b[m] = () => b
      b.update = () => b
      const one = async () => {
        if (table === 'contracts') return { data: state.contract, error: null }
        if (table === 'rental_reservations' && cols.includes('products')) return { data: { products: { name: '소니 FX3', parent_product_id: null } }, error: null }
        if (table === 'rental_reservations') return { data: { status: state.reservationStatus }, error: null }
        if (table === 'contract_signings') return { data: state.existingSigning ?? { token: 'tok-new' }, error: null }
        if (table === 'user_profiles' && cols.includes('withdrawal_status')) return { data: { withdrawal_status: state.withdrawal }, error: null }
        if (table === 'user_profiles') return { data: { phone: state.phone }, error: null }
        return { data: null, error: null }
      }
      b.maybeSingle = async () => (table === 'contract_signings' ? { data: state.existingSigning, error: null } : one())
      b.single = one
      b.insert = (row: Record<string, unknown>) => {
        if (table === 'chat_messages') {
          state.order.push('chat')
          if (state.messageError) return Object.assign(Promise.resolve({ error: { message: 'x' } }), { select: () => b })
          state.chatInserts.push(row)
        }
        if (table === 'sms_notification_logs') state.smsLogs.push(row)
        return Object.assign(Promise.resolve({ error: null }), { select: () => b })
      }
      return b
    },
  }),
}))

import { POST } from '../../routes/api/cms/contracts/[id]/send-chat/+server'

const call = () =>
  POST({ params: { id: 'c1' }, locals: { safeGetSession: async () => ({ session: { user: { id: 'admin1' } } }) }, url: new URL('https://crazyshot.kr/api/cms/contracts/c1/send-chat') } as never)

beforeEach(() => {
  vi.clearAllMocks()
  envModule.dev = false
  mockSend.mockResolvedValue({ failedMessageList: [] })
  Object.assign(state, {
    order: [], role: 'manager', reservationStatus: 'hold', existingSigning: null, sessionError: false, messageError: false,
    phone: '010-3333-4444', withdrawal: 'none', chatInserts: [], pushCalls: [], smsLogs: [], audit: [],
    contract: { id: 'c1', user_id: 'u1', reservation_id: 501, content_blocks: [], spreadsheet_document: null, html_document: null, authoring_mode: 'content_blocks' },
  })
})

describe('POST send-chat — 전자계약 발행 시 채팅카드 + 푸시 + SMS 동시 발송', () => {
  it('최초 발행: 채팅카드(contract_link) → 푸시 → SMS가 한 번의 요청에서 모두 나가고 SMS에는 서명 링크가 들어간다', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    const url = 'https://crazyshot.kr/contract/tok-new'
    expect(state.chatInserts).toHaveLength(1)
    expect(state.chatInserts[0]).toMatchObject({ sender_type: 'admin', message_type: 'action_card', action_payload: { type: 'contract_link', action_url: url } })
    expect(state.pushCalls).toEqual([{ userId: 'u1', type: 'contract_sent', payload: expect.objectContaining({ link: url }) }])
    expect(mockSend).toHaveBeenCalledTimes(1)
    const sms = mockSend.mock.calls[0][0] as { to: string; text: string }
    expect(sms.to).toBe('01033334444')
    expect(sms.text).toContain('소니 FX3')
    expect(sms.text).toContain('전자계약서가 도착했어요')
    expect(sms.text).toContain(url)
    expect(state.order).toEqual(['chat', 'push', 'sms'])
    expect(state.smsLogs.filter((l) => l.status === 'sent' && l.notify_type === 'contract_link')).toHaveLength(1)
    expect(state.audit.some((a) => a.eventType === 'sent')).toBe(true)
  })

  it('재발송(기존 서명 링크, 같은 날): 같은 날이라도 채팅·푸시·SMS가 매번 다시 나간다(force)', async () => {
    state.existingSigning = { id: 's1', token: 'tok-old', signed_at: null }
    await call()
    await call()
    expect(state.chatInserts).toHaveLength(2)
    expect(state.pushCalls).toHaveLength(2)
    expect(mockSend).toHaveBeenCalledTimes(2)
    expect((mockSend.mock.calls[1][0] as { text: string }).text).toContain('https://crazyshot.kr/contract/tok-old')
  })

  it('채팅 세션 생성에 실패하면 500이고 푸시·SMS는 나가지 않는다(채팅 없이 문자만 가는 일 방지)', async () => {
    state.sessionError = true
    expect((await call()).status).toBe(500)
    expect(state.pushCalls).toHaveLength(0)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('채팅 메시지 저장에 실패하면 500이고 푸시·SMS는 나가지 않는다', async () => {
    state.messageError = true
    expect((await call()).status).toBe(500)
    expect(state.pushCalls).toHaveLength(0)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('SMS 업체가 실패해도 발송 요청은 성공(채팅·푸시 보존)하고 실패 로그가 남는다', async () => {
    mockSend.mockRejectedValue(new Error('solapi down'))
    const res = await call()
    expect(res.status).toBe(200)
    expect(state.chatInserts).toHaveLength(1)
    expect(state.pushCalls).toHaveLength(1)
    expect(state.smsLogs.some((l) => l.status === 'failed')).toBe(true)
  })

  it('전화번호가 없으면 채팅·푸시만 나가고 SMS는 건너뛴다', async () => {
    state.phone = null
    expect((await call()).status).toBe(200)
    expect(state.chatInserts).toHaveLength(1)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('탈퇴 신청·삭제 계정에는 SMS를 보내지 않는다(채팅·푸시는 유지)', async () => {
    for (const w of ['requested', 'purged']) {
      state.withdrawal = w
      await call()
    }
    expect(state.chatInserts).toHaveLength(2)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('개발 환경에서는 실제 SMS를 보내지 않는다', async () => {
    envModule.dev = true
    await call()
    expect(state.chatInserts).toHaveLength(1)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('이미 서명 완료된 계약서는 400 — 어떤 알림도 나가지 않는다', async () => {
    state.existingSigning = { id: 's1', token: 't', signed_at: '2026-10-08T00:00:00Z' }
    expect((await call()).status).toBe(400)
    expect(state.chatInserts).toHaveLength(0)
    expect(state.pushCalls).toHaveLength(0)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('취소·만료된 예약은 422 — 어떤 알림도 나가지 않는다', async () => {
    for (const s of ['cancelled', 'expired']) {
      state.reservationStatus = s
      expect((await call()).status).toBe(422)
    }
    expect(state.chatInserts).toHaveLength(0)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('매니저 미만(파트너)은 403 — 어떤 알림도 나가지 않는다', async () => {
    state.role = 'partner'
    expect((await call()).status).toBe(403)
    expect(state.chatInserts).toHaveLength(0)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('계약서가 없으면 404다', async () => {
    state.contract = null
    expect((await call()).status).toBe(404)
    expect(mockSend).not.toHaveBeenCalled()
  })
})

describe('서명 완료(contract_signed)·재공유 — 동시 발송 배선 점검(소스)', () => {
  const read = (p: string) => readFileSync(p, 'utf8')

  it('서명 완료 API는 채팅카드(contract_signed) 저장 뒤에 푸시와 SMS(contract_signed)를 같이 보낸다', () => {
    const src = read('src/routes/api/contracts/[token]/sign/+server.ts')
    const chat = src.indexOf("type:         'contract_signed'")
    const push = src.indexOf("sendPushToUser(signing.user_id, 'contract_signed_customer'")
    const sms = src.indexOf("notifyType: 'contract_signed'")
    expect(chat).toBeGreaterThan(-1)
    expect(push).toBeGreaterThan(chat)
    expect(sms).toBeGreaterThan(push)
  })

  it('완료 계약서 재공유(share-chat)도 채팅카드 저장 뒤에 푸시와 SMS(재공유 전용 contract_reshare, force)를 같이 보낸다 — 실제 동작은 contractShareDispatch.test.ts', () => {
    const src = read('src/routes/api/cms/contracts/[id]/share-chat/+server.ts')
    const chat = src.indexOf(".from('chat_messages')")
    const push = src.indexOf("sendPushToUser(contract.user_id, 'contract_signed_customer'")
    const sms = src.indexOf("notifyType: 'contract_reshare'")
    expect(chat).toBeGreaterThan(-1)
    expect(push).toBeGreaterThan(chat)
    expect(sms).toBeGreaterThan(push)
    expect(src).toMatch(/notifyType: 'contract_reshare',[\s\S]*force: true/)
  })
})
