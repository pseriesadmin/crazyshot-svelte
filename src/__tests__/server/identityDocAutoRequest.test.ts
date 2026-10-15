import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 본인증명 미등록 고객 자동 등록 요청 (2026-10-15, Stephen 확정)
 *  - 상품상세 장바구니 담기·예약신청, 장바구니 예약신청 시 기존 "본인증명 등록요청" 토스트 대신
 *    서버가 기존 identity_request 대화카드 + 푸시 + SMS로 등록을 요청한다(예약은 막지 않는다).
 *  - 서류 미등록(none)일 때만 보낸다(승인 대기·승인 완료는 요청하지 않음). 24시간 안에 같은 카드가 있으면 다시 보내지 않는다.
 *  - 카드 CTA는 개인정보 > 본인증명 영역(?tab=profile&doc=identity|foreign)으로 랜딩한다.
 */
vi.mock('$app/environment', () => ({ dev: false }))
const pushCalls: Array<{ userId: string; type: string; payload: Record<string, unknown> }> = []
vi.mock('$lib/server/push', () => ({
  sendPushToUser: vi.fn(async (userId: string, type: string, payload: Record<string, unknown>) => {
    pushCalls.push({ userId, type, payload })
  }),
}))
let overrideText: string | null = null
vi.mock('$lib/server/notifyMessages', () => ({
  getNotifyMessageOverride: vi.fn(async () => overrideText),
}))
const smsCalls: Array<{ to: string; message: string }> = []
let smsShouldFail = false
vi.mock('$lib/server/sms', () => ({
  sendSms: vi.fn(async (to: string, message: string) => {
    if (smsShouldFail) throw new Error('SMS 발송 실패')
    smsCalls.push({ to, message })
  }),
}))

const profileRow: Record<string, unknown> = {}
const inserted: Array<Record<string, unknown>> = []
let recentCard = false
let rpcSession: string | null = 'sess-1'
let insertError: { message: string } | null = null

function makeAdmin() {
  return {
    rpc: async () => ({ data: rpcSession, error: rpcSession ? null : { message: 'no session' } }),
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      Object.assign(chain, {
        select: () => chain,
        eq: () => chain,
        gte: () => chain,
        limit: async () => ({ data: recentCard ? [{ id: 'old-card' }] : [], error: null }),
        maybeSingle: async () => ({ data: profileRow, error: null }),
        insert: async (v: Record<string, unknown>) => {
          if (insertError) return { error: insertError }
          inserted.push({ table, ...v })
          return { error: null }
        },
        update: () => chain,
        then: (res: (v: unknown) => unknown) => res({ error: null }),
      })
      return chain
    },
  } as never
}

const NONE = { full_name: '홍길동', phone: '010-1234-5678', withdrawal_status: 'none', identity_doc_url: null, identity_type: null }
const PENDING = {
  ...NONE,
  identity_doc_url: ['u/a.pdf', 'u/b.pdf'],
  identity_type: ['resident', 'resident_copy'],
  identity_verified_at: '2026-10-05T01:00:00Z',
  identity_approved_at: null,
}
const APPROVED = { ...PENDING, identity_approved_at: '2026-10-06T01:00:00Z' }
const FOREIGN_NONE = {
  ...NONE,
  foreign_doc_urls: ['u/p.pdf'],
  foreign_type: ['passport_photo'],
  identity_doc_url: null,
  identity_type: null,
}

beforeEach(() => {
  pushCalls.length = 0
  smsCalls.length = 0
  inserted.length = 0
  for (const k of Object.keys(profileRow)) delete profileRow[k]
  recentCard = false
  rpcSession = 'sess-1'
  insertError = null
  smsShouldFail = false
  overrideText = null
})

describe('requestIdentityDocRegistration', () => {
  it('서류 미등록 → 기존 identity_request 카드 + 푸시 + SMS를 보낸다(카드 CTA는 본인증명 영역으로 랜딩)', async () => {
    Object.assign(profileRow, NONE)
    const { requestIdentityDocRegistration } = await import('$lib/server/identityDocRequest')
    const r = await requestIdentityDocRegistration(makeAdmin(), 'user-1')
    expect(r).toMatchObject({ requested: true, reason: 'sent' })

    const card = inserted.find((m) => m.table === 'chat_messages')
    expect(card).toMatchObject({ session_id: 'sess-1', sender_type: 'admin', message_type: 'action_card' })
    expect(card?.content).toBe('개인정보 메뉴에서 본인증명정보를 등록 부탁드립니다.')
    expect(card?.action_payload).toMatchObject({
      type: 'identity_request',
      doc_type: 'identity',
      button_label: '본인증명 등록요청',
      action_url: '/account/profile?tab=profile&doc=identity',
    })

    expect(pushCalls).toHaveLength(1)
    expect(pushCalls[0]).toMatchObject({ userId: 'user-1', type: 'identity_request' })
    expect(pushCalls[0].payload.link).toBe('/account/profile?tab=profile&doc=identity')

    expect(smsCalls).toHaveLength(1)
    expect(smsCalls[0].to).toBe('010-1234-5678')
    expect(smsCalls[0].message).toContain('[크레이지샷]')
    expect(smsCalls[0].message).toContain('본인증명정보')
    expect(smsCalls[0].message).toContain('https://crazyshot.kr/account/profile?tab=profile&doc=identity')
  })

  it('CMS에서 편집한 안내문장이 있으면 카드·SMS 모두 그 문장을 쓴다(고객이름 치환, SMS는 [크레이지샷] 접두어 + 링크)', async () => {
    Object.assign(profileRow, NONE)
    overrideText = '{{고객이름}}님, 예약 확정을 위해 본인증명을 등록해 주세요.'
    const { requestIdentityDocRegistration } = await import('$lib/server/identityDocRequest')
    await requestIdentityDocRegistration(makeAdmin(), 'user-1')
    const card = inserted.find((m) => m.table === 'chat_messages')
    expect(card?.content).toBe('홍길동님, 예약 확정을 위해 본인증명을 등록해 주세요.')
    expect(smsCalls[0].message).toBe('[크레이지샷] 홍길동님, 예약 확정을 위해 본인증명을 등록해 주세요.\nhttps://crazyshot.kr/account/profile?tab=profile&doc=identity')
  })

  it('안내문장이 비어 있으면(미설정) 기본 문구를 그대로 쓴다', async () => {
    Object.assign(profileRow, NONE)
    overrideText = null
    const { requestIdentityDocRegistration } = await import('$lib/server/identityDocRequest')
    await requestIdentityDocRegistration(makeAdmin(), 'user-1')
    expect(inserted.find((m) => m.table === 'chat_messages')?.content).toBe('개인정보 메뉴에서 본인증명정보를 등록 부탁드립니다.')
    expect(smsCalls[0].message.startsWith('[크레이지샷] 예약 진행을 위해 본인증명정보를 등록해 주세요.')).toBe(true)
  })

  it('외국인증명만 시작한 고객 → 카드·푸시·SMS 링크가 외국인증명 영역(doc=foreign)으로 랜딩한다', async () => {
    Object.assign(profileRow, FOREIGN_NONE)
    const { requestIdentityDocRegistration } = await import('$lib/server/identityDocRequest')
    const r = await requestIdentityDocRegistration(makeAdmin(), 'user-1')
    expect(r.requested).toBe(true)
    const card = inserted.find((m) => m.table === 'chat_messages')
    expect((card?.action_payload as Record<string, unknown>).action_url).toBe('/account/profile?tab=profile&doc=foreign')
    expect(smsCalls[0].message).toContain('doc=foreign')
  })

  it('승인 대기(pending) → 요청하지 않는다(이미 등록함)', async () => {
    Object.assign(profileRow, PENDING)
    const { requestIdentityDocRegistration } = await import('$lib/server/identityDocRequest')
    const r = await requestIdentityDocRegistration(makeAdmin(), 'user-1')
    expect(r).toMatchObject({ requested: false, reason: 'gate_pending' })
    expect(inserted).toHaveLength(0)
    expect(pushCalls).toHaveLength(0)
    expect(smsCalls).toHaveLength(0)
  })

  it('승인 완료(approved) → 요청하지 않는다', async () => {
    Object.assign(profileRow, APPROVED)
    const { requestIdentityDocRegistration } = await import('$lib/server/identityDocRequest')
    const r = await requestIdentityDocRegistration(makeAdmin(), 'user-1')
    expect(r).toMatchObject({ requested: false, reason: 'gate_approved' })
    expect(inserted).toHaveLength(0)
  })

  it('24시간 안에 이미 같은 요청 카드가 있으면 다시 보내지 않는다(카드·푸시·SMS 모두)', async () => {
    Object.assign(profileRow, NONE)
    recentCard = true
    const { requestIdentityDocRegistration } = await import('$lib/server/identityDocRequest')
    const r = await requestIdentityDocRegistration(makeAdmin(), 'user-1')
    expect(r).toMatchObject({ requested: false, reason: 'recently_requested' })
    expect(inserted).toHaveLength(0)
    expect(pushCalls).toHaveLength(0)
    expect(smsCalls).toHaveLength(0)
  })

  it('SMS 발송이 실패해도 카드와 푸시는 유지되고 요청은 성공으로 본다(fail-soft)', async () => {
    Object.assign(profileRow, NONE)
    smsShouldFail = true
    const { requestIdentityDocRegistration } = await import('$lib/server/identityDocRequest')
    const r = await requestIdentityDocRegistration(makeAdmin(), 'user-1')
    expect(r.requested).toBe(true)
    expect(inserted.some((m) => m.table === 'chat_messages')).toBe(true)
    expect(pushCalls).toHaveLength(1)
  })

  it('전화번호가 없으면 카드·푸시만 보낸다', async () => {
    Object.assign(profileRow, { ...NONE, phone: null })
    const { requestIdentityDocRegistration } = await import('$lib/server/identityDocRequest')
    const r = await requestIdentityDocRegistration(makeAdmin(), 'user-1')
    expect(r.requested).toBe(true)
    expect(smsCalls).toHaveLength(0)
    expect(pushCalls).toHaveLength(1)
  })

  it('탈퇴 신청·삭제 상태 계정은 아무것도 보내지 않는다', async () => {
    Object.assign(profileRow, { ...NONE, withdrawal_status: 'requested' })
    const { requestIdentityDocRegistration } = await import('$lib/server/identityDocRequest')
    const r = await requestIdentityDocRegistration(makeAdmin(), 'user-1')
    expect(r).toMatchObject({ requested: false, reason: 'withdrawn' })
    expect(inserted).toHaveLength(0)
    expect(smsCalls).toHaveLength(0)
  })

  it('카드 저장에 실패하면 푸시·SMS도 보내지 않는다', async () => {
    Object.assign(profileRow, NONE)
    insertError = { message: 'db down' }
    const { requestIdentityDocRegistration } = await import('$lib/server/identityDocRequest')
    const r = await requestIdentityDocRegistration(makeAdmin(), 'user-1')
    expect(r).toMatchObject({ requested: false, reason: 'error' })
    expect(pushCalls).toHaveLength(0)
    expect(smsCalls).toHaveLength(0)
  })

  it('상담 세션을 찾지 못하면 아무것도 보내지 않는다', async () => {
    Object.assign(profileRow, NONE)
    rpcSession = null
    const { requestIdentityDocRegistration } = await import('$lib/server/identityDocRequest')
    const r = await requestIdentityDocRegistration(makeAdmin(), 'user-1')
    expect(r).toMatchObject({ requested: false, reason: 'error' })
    expect(inserted).toHaveLength(0)
  })
})

describe('buildIdentityRequestPayload (관리자 수동 요청 카드와 공용)', () => {
  it('identity/foreign 카드의 CTA 링크를 본인증명·외국인증명 영역으로 지정한다', async () => {
    const { buildIdentityRequestPayload } = await import('$lib/server/identityDocRequest')
    expect(buildIdentityRequestPayload('identity')).toMatchObject({
      type: 'identity_request',
      doc_type: 'identity',
      button_label: '본인증명 등록요청',
      action_url: '/account/profile?tab=profile&doc=identity',
    })
    expect(buildIdentityRequestPayload('foreign').action_url).toBe('/account/profile?tab=profile&doc=foreign')
  })
})
