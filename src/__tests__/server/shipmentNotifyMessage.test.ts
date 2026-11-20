import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 반출(배송) 알림 — 출고 처리(자동 09:00·관리자 수동) 직후 CMS 안내문장이 푸시·문자로 나가는지 (2026-11-18)
 *  - 운영에 저장된 안내문장({{택배사}}·{{운송장번호}} 포함)을 그대로 쓰고, 번호가 저장돼 있으면 두 값이 채워져 푸시·문자 본문에 실린다.
 *  - 번호가 아직 없으면(출고 처리가 접수보다 먼저 알림을 보내는 기존 순서) 그 두 줄은 빠진다.
 *  - 90바이트를 넘는 문장은 LMS 로 나간다.
 */

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k', FIREBASE_ADMIN_CLIENT_EMAIL: 'x', FIREBASE_ADMIN_PRIVATE_KEY: 'x' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://t.supabase.co', PUBLIC_FIREBASE_PROJECT_ID: 'p' }))
vi.mock('$env/dynamic/private', () => ({ env: { SOLAPI_API_KEY: 'a', SOLAPI_API_SECRET: 'b', SMS_SENDER_PHONE: '0212345678' } }))
vi.mock('$app/environment', () => ({ dev: false }))

const mockSend = vi.hoisted(() => vi.fn())
vi.mock('solapi', () => ({ SolapiMessageService: vi.fn().mockImplementation(function () { return { send: mockSend } }) }))
vi.mock('firebase-admin/app', () => ({ cert: vi.fn(), getApps: () => [], initializeApp: vi.fn() }))
vi.mock('$lib/server/crazychat/action', () => ({ AGENT_REQUEST_KIND_LABEL: {} }))
vi.mock('$lib/server/lockerGuideMessage', () => ({ composeLockerGuideMessage: async () => null }))
vi.mock('$lib/server/adminPushMenuFilter', () => ({ filterAdminPushRecipientsByMenu: async (_c: unknown, _k: string, ids: string[]) => ids }))

// 푸시 경로용 — FCM 발송 내용을 캡처
const fcmSend = vi.hoisted(() => vi.fn())
vi.mock('firebase-admin/messaging', () => ({ getMessaging: () => ({ sendEachForMulticast: fcmSend }) }))

const trackingState: { number: string | null; courier: string | null } = { number: null, courier: null }
interface Cfg { message: string | null; push_enabled: boolean }
let cfgByType: Record<string, Cfg>

function makeChain(table: string, state: { filterType?: string }) {
  const b: Record<string, unknown> = {}
  b.select = () => b
  b.eq = (k: string, v: unknown) => { if (k === 'notify_type') state.filterType = String(v); return b }
  b.returns = () => b
  for (const m of ['in', 'is', 'limit', 'order', 'gte', 'lte']) b[m] = () => b
  const row = () => {
    if (table === 'push_notification_config') {
      const c = state.filterType ? cfgByType[state.filterType] : undefined
      return c ? { data: { push_enabled: c.push_enabled, category: 'customer_lifecycle', extra_config: c.message ? { message: c.message } : {} }, error: null } : { data: null, error: null }
    }
    if (table === 'user_profiles') return { data: { allow_rental_alert: true, phone: '010-1111-2222', full_name: '홍길동', withdrawal_status: 'none' }, error: null }
    if (table === 'notification_tokens') return { data: [{ user_id: 'u1', token: 't1' }], error: null }
    if (table === 'rental_reservations') return { data: { user_id: 'u1', reservation_code: 'CS2610001', start_date: '2026-10-12', end_date: '2026-10-14', pickup_time: '14:00', return_time: '14:00', tracking_number: trackingState.number, courier_code: trackingState.courier, dhero_meta: null, products: { name: '소니 FX3', parent_product_id: null } }, error: null }
    return { data: null, error: null }
  }
  b.maybeSingle = async () => row()
  b.single = async () => row()
  // 목록 조회(await chain) — push_notification_config 전체 / notification_tokens
  b.then = (res: (v: unknown) => unknown) => {
    if (table === 'push_notification_config') {
      const data = Object.entries(cfgByType).map(([notify_type, c]) => ({ notify_type, extra_config: c.message ? { message: c.message } : {} }))
      return Promise.resolve({ data, error: null }).then(res)
    }
    if (table === 'notification_tokens') return Promise.resolve({ data: [{ user_id: 'u1', token: 't1' }], error: null }).then(res)
    return Promise.resolve({ data: null, error: null }).then(res)
  }
  b.insert = async () => ({ error: null })
  return b
}

function fakeClient() {
  return { from: (table: string) => makeChain(table, {}), rpc: async () => ({ data: null, error: null }) } as never
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeClient() }))

import { sendReservationLifecyclePush } from '$lib/server/push'
import { clearNotifyMessageCache } from '$lib/server/notifyMessages'

// 운영 반출(배송) 알림에 저장된 문장(2026-11-18 기준)
const PROD_MESSAGE = '[크레이지샷 택배 출고 완료 안내]\n안녕하세요, 고객님!\n예약하신 장비의 검수 및 포장이 완료되어 금일 출고 처리되었습니다.\n■ 택배사: {{택배사}}\n■ 송장번호: {{운송장번호}}\n> 장비 수령 직후 구성품 누락 및 정상 작동 여부를 꼭 확인해 주세요.'

beforeEach(() => {
  vi.clearAllMocks()
  clearNotifyMessageCache()
  cfgByType = { shipment_notify: { message: PROD_MESSAGE, push_enabled: true } }
  trackingState.number = null
  trackingState.courier = null
  mockSend.mockResolvedValue({ failedMessageList: [] })
  fcmSend.mockResolvedValue({ responses: [{ success: true }] })
})

const pushBody = () => (fcmSend.mock.calls[0][0] as { webpush: { notification: { body: string } } }).webpush.notification.body
const smsArg = () => mockSend.mock.calls[0][0] as { text: string; type: string; subject?: string }

describe('반출(배송) 알림 — 번호가 저장된 뒤(자동 발행·번호 있는 수동 처리)', () => {
  beforeEach(() => { trackingState.number = '146706720056'; trackingState.courier = '두발히어로' })

  it('푸시 본문이 저장된 안내문장이고 택배사·운송장 번호가 채워진다', async () => {
    await sendReservationLifecyclePush(fakeClient(), 501, 'shipment_notify')
    expect(pushBody()).toContain('[크레이지샷 택배 출고 완료 안내]')
    expect(pushBody()).toContain('■ 택배사: 두발히어로')
    expect(pushBody()).toContain('■ 송장번호: 146706720056')
    expect(pushBody()).not.toContain('{{')
  })

  it('문자도 같은 문장(+[크레이지샷] 접두·링크)이고 LMS 로 나간다', async () => {
    await sendReservationLifecyclePush(fakeClient(), 501, 'shipment_notify')
    expect(smsArg().text).toContain('■ 택배사: 두발히어로')
    expect(smsArg().text).toContain('■ 송장번호: 146706720056')
    expect(smsArg().text).toContain('https://crazyshot.kr/account/rental')
    expect(smsArg().type).toBe('LMS')
    expect(smsArg().subject).toBe('[크레이지샷]')
  })
})

describe('반출(배송) 알림 — 번호가 아직 없을 때(출고 처리가 접수보다 먼저 알림을 보내는 경우)', () => {
  it('택배사·송장번호 두 줄이 빠진 채 푸시·문자가 나간다', async () => {
    await sendReservationLifecyclePush(fakeClient(), 501, 'shipment_notify')
    expect(pushBody()).not.toContain('택배사')
    expect(pushBody()).not.toContain('송장번호')
    expect(smsArg().text).not.toContain('송장번호')
    expect(pushBody()).toContain('금일 출고 처리되었습니다')
  })
})

describe('반출(배송) 알림 — 발송 OFF', () => {
  it('설정에서 끄면 푸시가 나가지 않는다', async () => {
    cfgByType.shipment_notify = { message: PROD_MESSAGE, push_enabled: false }
    trackingState.number = '1'; trackingState.courier = '두발히어로'
    await sendReservationLifecyclePush(fakeClient(), 501, 'shipment_notify')
    expect(fcmSend).not.toHaveBeenCalled()
  })
})
