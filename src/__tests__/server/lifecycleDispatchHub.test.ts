import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 예약·대여 알림 "채팅카드 + SMS 동시 발송" — 허브(sendReservationLifecyclePush) 전수 테스트 (2026-10-08)
 *
 * 채팅카드는 각 호출부가 send_rental_chat_notification RPC로 먼저 만들고, 직후 같은 notify_type으로 이 허브를 호출한다.
 * 허브는 고객 푸시를 시도하고(실패해도 무관) 대상 타입이면 SMS를 항상 같이 보낸다.
 *   (용어: '묶음 주문'은 폐기된 옛 구조 — 지금은 장바구니 1주문 = 예약코드 1개에 상품·옵션 여러 개)
 *   SMS 대상 7종(허브 경유): reservation_approval · shipment_notify · tracking_notify · dhero_place_guide · return_registration · return_remind · reservation_cancelled
 *   계약서 3종(contract_link·contract_signed·재공유 contract_reshare)은 허브를 거치지 않고 sendCardSms로 직접 — contractSendDispatch.test.ts에서 검증.
 *   SMS 비대상: rental_confirm · rental_complete · damage_claimed · hold_expired · reservation_hold · payment_cancelled_reissue · locker_guide
 */

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k', FIREBASE_ADMIN_CLIENT_EMAIL: 'x', FIREBASE_ADMIN_PRIVATE_KEY: 'x' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://t.supabase.co', PUBLIC_FIREBASE_PROJECT_ID: 'p' }))
vi.mock('$env/dynamic/private', () => ({ env: { SOLAPI_API_KEY: 'a', SOLAPI_API_SECRET: 'b', SMS_SENDER_PHONE: '0212345678' } }))
const envModule = vi.hoisted(() => ({ dev: false }))
vi.mock('$app/environment', () => envModule)

const mockSend = vi.hoisted(() => vi.fn())
vi.mock('solapi', () => ({ SolapiMessageService: vi.fn().mockImplementation(function () { return { send: mockSend } }) }))
vi.mock('firebase-admin/app', () => ({ cert: vi.fn(), getApps: () => [], initializeApp: vi.fn() }))
vi.mock('firebase-admin/messaging', () => ({ getMessaging: () => ({ send: vi.fn(), sendEachForMulticast: vi.fn() }) }))
vi.mock('$lib/server/crazychat/action', () => ({ AGENT_REQUEST_KIND_LABEL: {} }))
vi.mock('$lib/server/adminPushMenuFilter', () => ({ filterAdminPushRecipientsByMenu: async (_c: unknown, _k: string, ids: string[]) => ids }))
// 푸시 발송 자체의 DB 조회는 실패하도록(= 푸시가 전달되지 않는 상황) — SMS는 푸시와 무관하게 나가야 한다
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => {
    const chain: Record<string, unknown> = {}
    const fail = async () => ({ data: null, error: { message: 'push db unavailable' } })
    for (const m of ['select', 'eq', 'in', 'is', 'limit', 'order', 'gte', 'lte', 'insert', 'update']) chain[m] = () => chain
    chain.maybeSingle = fail
    chain.single = fail
    chain.then = (res: (v: unknown) => unknown) => fail().then(res)
    return { from: () => chain, rpc: fail }
  },
}))

import { readFileSync } from 'node:fs'
import { sendReservationLifecyclePush } from '$lib/server/push'
import { sendApprovalNotifications } from '$lib/server/sendApprovalNotifications'

interface Db { phone: string | null; withdrawal: string; dupLog: boolean; productParent: string | null }
let db: Db
const smsLogs: Record<string, unknown>[] = []

function fakeAdmin() {
  const from = (table: string) => {
    const f: Record<string, unknown> = {}
    let cols = ''
    const b: Record<string, unknown> = {}
    b.select = (c: string) => { cols = c; return b }
    b.eq = (k: string, v: unknown) => { f[k] = v; return b }
    for (const m of ['in', 'is', 'limit', 'gte', 'lte', 'order']) b[m] = () => b
    const one = async () => {
      if (table === 'rental_reservations') return { data: { user_id: 'u1', products: { name: '소니 FX3', parent_product_id: db.productParent } }, error: null }
      if (table === 'user_profiles' && cols.includes('withdrawal_status')) return { data: { withdrawal_status: db.withdrawal }, error: null }
      if (table === 'user_profiles') return { data: { phone: db.phone }, error: null }
      if (table === 'sms_notification_logs') return { data: db.dupLog ? { id: 1 } : null, error: null }
      return { data: null, error: null }
    }
    b.maybeSingle = one
    b.single = one
    if (table === 'sms_notification_logs') b.insert = async (row: Record<string, unknown>) => { smsLogs.push(row); return { error: null } }
    return b
  }
  return { from } as never
}

const SMS_TYPES = ['reservation_approval', 'shipment_notify', 'tracking_notify', 'dhero_place_guide', 'return_registration', 'return_remind', 'reservation_cancelled']
const NON_SMS_TYPES = ['rental_confirm', 'rental_complete', 'damage_claimed', 'hold_expired', 'reservation_hold', 'payment_cancelled_reissue', 'locker_guide']

beforeEach(() => {
  vi.clearAllMocks()
  envModule.dev = false
  db = { phone: '010-1111-2222', withdrawal: 'none', dupLog: false, productParent: null }
  smsLogs.length = 0
  mockSend.mockResolvedValue({ failedMessageList: [] })
})

describe('허브 — SMS 대상 7종은 채팅카드와 같은 시점에 SMS가 동시에 나간다', () => {
  for (const type of SMS_TYPES) {
    it(`${type}: SMS 1통 발송(수신번호 숫자만·상품명 포함·사이트 링크)`, async () => {
      await sendReservationLifecyclePush(fakeAdmin(), 501, type)
      expect(mockSend).toHaveBeenCalledTimes(1)
      const arg = mockSend.mock.calls[0][0] as { to: string; from: string; text: string }
      expect(arg.to).toBe('01011112222')
      expect(arg.from).toBe('0212345678')
      expect(arg.text).toContain('[크레이지샷]')
      expect(arg.text).toContain('소니 FX3')
      expect(arg.text).toContain('http')
      expect(smsLogs.filter((l) => l.status === 'sent' && l.notify_type === type)).toHaveLength(1)
    })
  }
})

describe('허브 — SMS 비대상 타입은 SMS가 나가지 않는다(의도된 정책)', () => {
  for (const type of NON_SMS_TYPES) {
    it(`${type}: SMS 없음`, async () => {
      await sendReservationLifecyclePush(fakeAdmin(), 501, type)
      expect(mockSend).not.toHaveBeenCalled()
    })
  }
})

describe('허브 — 제외·예외 조건', () => {
  it('푸시가 전달되지 않아도(토큰 없음·DB 오류) SMS는 발송된다', async () => {
    await sendReservationLifecyclePush(fakeAdmin(), 501, 'reservation_approval')
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it('skipSms·skipSmsFallback(한 주문에 담긴 여러 상품 중 대표 1건 외·호출부가 이미 발송)은 SMS를 건너뛴다', async () => {
    await sendReservationLifecyclePush(fakeAdmin(), 501, 'reservation_approval', { skipSms: true })
    await sendReservationLifecyclePush(fakeAdmin(), 501, 'return_remind', { skipSmsFallback: true })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('전화번호가 없으면 SMS를 보내지 않는다', async () => {
    db.phone = null
    await sendReservationLifecyclePush(fakeAdmin(), 501, 'shipment_notify')
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('탈퇴 신청(requested)·삭제(purged) 계정에는 SMS를 보내지 않는다', async () => {
    for (const w of ['requested', 'purged']) {
      db.withdrawal = w
      await sendReservationLifecyclePush(fakeAdmin(), 501, 'shipment_notify')
    }
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('같은 날 같은 (예약, 알림 종류)는 중복 발송하지 않지만 forceSms면 다시 보낸다', async () => {
    db.dupLog = true
    await sendReservationLifecyclePush(fakeAdmin(), 501, 'tracking_notify')
    expect(mockSend).not.toHaveBeenCalled()
    await sendReservationLifecyclePush(fakeAdmin(), 501, 'tracking_notify', { forceSms: true })
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it('smsLink를 지정하면 그 링크가 문자에 들어간다', async () => {
    await sendReservationLifecyclePush(fakeAdmin(), 501, 'return_remind', { smsLink: '/account/rental/501/history' })
    expect((mockSend.mock.calls[0][0] as { text: string }).text).toContain('https://crazyshot.kr/account/rental/501/history')
  })

  it('개발 환경(dev)에서는 실제 발송하지 않는다', async () => {
    envModule.dev = true
    await sendReservationLifecyclePush(fakeAdmin(), 501, 'reservation_approval')
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('SMS 업체 오류가 나도 예외를 던지지 않고(채팅·푸시 흐름 보호) 실패 로그를 남긴다', async () => {
    mockSend.mockRejectedValue(new Error('solapi down'))
    await expect(sendReservationLifecyclePush(fakeAdmin(), 501, 'reservation_cancelled')).resolves.toBeUndefined()
    expect(smsLogs.some((l) => l.status === 'failed')).toBe(true)
  })

  it('업체가 일부 실패를 응답해도(failedMessageList) 예외 없이 실패로 기록한다', async () => {
    mockSend.mockResolvedValue({ failedMessageList: [{ to: '01011112222', statusMessage: 'x' }] })
    await expect(sendReservationLifecyclePush(fakeAdmin(), 501, 'shipment_notify')).resolves.toBeUndefined()
    expect(smsLogs.some((l) => l.status === 'failed')).toBe(true)
    expect(smsLogs.some((l) => l.status === 'sent')).toBe(false)
  })
})

// ── 승인 알림(한 주문=예약코드 1개에 상품 여러 개 — 통합/개별/보류) — 채팅카드와 SMS 개수가 어긋나지 않는지 ──
describe('sendApprovalNotifications — 승인 채팅카드와 SMS는 주문당 1세트', () => {
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = []
  const adminWithRpc = () => {
    const base = fakeAdmin() as unknown as { from: unknown }
    return { ...base, rpc: async (name: string, args: Record<string, unknown>) => { rpcCalls.push({ name, args }); return { data: null, error: null } } } as never
  }
  beforeEach(() => { rpcCalls.length = 0 })

  it('보류(hold): 같은 주문의 다른 상품이 아직 미승인이면 채팅카드·SMS 모두 보내지 않는다', async () => {
    await sendApprovalNotifications(adminWithRpc(), 501, { mode: 'hold' })
    expect(rpcCalls).toHaveLength(0)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('개별(single): 채팅카드 1건 + SMS 1통', async () => {
    await sendApprovalNotifications(adminWithRpc(), 501, { mode: 'single' })
    expect(rpcCalls.map((c) => c.name)).toEqual(['send_rental_chat_notification'])
    expect(rpcCalls[0].args).toMatchObject({ p_reservation_id: 501, p_notify_type: 'reservation_approval' })
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it('통합(batch): 한 주문에 담긴 상품이 여럿이어도 통합 채팅카드 1건 + SMS는 1통만 나간다', async () => {
    await sendApprovalNotifications(adminWithRpc(), 501, { mode: 'batch', reservationIds: [501, 502, 503] })
    expect(rpcCalls.map((c) => c.name)).toEqual(['send_rental_chat_notification_batch'])
    expect(rpcCalls[0].args).toMatchObject({ p_reservation_ids: [501, 502, 503], p_notify_type: 'reservation_approval' })
    expect(mockSend).toHaveBeenCalledTimes(1)
  })
})

// ── 호출부 배선: 채팅카드 RPC 직후에 허브(SMS 포함)를 부르는지 ──
describe('호출부 배선 — 채팅카드 발송 지점마다 허브 호출이 뒤따른다(소스 점검)', () => {
  const read = (p: string) => readFileSync(p, 'utf8')
  const FILES = [
    'src/lib/server/rentalQrTransition.ts',
    'src/lib/server/dheroAutoAdvance.ts',
    'src/lib/server/cancelReservationWithRefund.ts',
    'src/lib/server/sendApprovalNotifications.ts',
    'src/routes/cms/rentals/+page.server.ts',
    'src/routes/cms/reservation/+page.server.ts',
    'src/routes/api/checkout/cancel-reservation/+server.ts',
    'src/routes/api/cms/reservations/[id]/payment/+server.ts',
    'src/routes/api/cms/reservations/[id]/tracking/+server.ts',
    'src/routes/api/cron/return-remind/+server.ts',
  ]
  for (const f of FILES) {
    it(`${f}: 채팅카드 RPC 이후에 허브 호출이 있다`, () => {
      const src = read(f)
      const rpc = src.indexOf('send_rental_chat_notification')
      const hub = src.search(/sendReservationLifecyclePush\(/)
      expect(rpc).toBeGreaterThan(-1)
      expect(hub).toBeGreaterThan(rpc)
    })
  }

  it('상태 전이 자동발송 표(AUTO_NOTIFY)에 SMS 대상 shipment_notify·return_registration이 있고 변수 notifyType으로 허브를 호출한다', () => {
    const src = read('src/routes/cms/reservation/+page.server.ts')
    expect(src).toContain("shipment_notify")
    expect(src).toContain("return_registration")
    expect(src).toMatch(/sendReservationLifecyclePush\(admin, reservationId, notifyType\)/)
  })

  it('SMS 대상 notify_type 문구 목록이 허브 테스트의 대상(7종+계약 2종)과 일치한다', async () => {
    const { LIFECYCLE_SMS_COPY } = await import('$lib/server/sms')
    expect(Object.keys(LIFECYCLE_SMS_COPY).sort()).toEqual([...SMS_TYPES, 'contract_link', 'contract_signed', 'contract_reshare'].sort())
  })
})
