import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 알림 안내문장(CMS 편집값) 적용 — 문자(허브·카드)·푸시 경로 (2026-10-10)
 *  - 편집값이 있으면 `[크레이지샷] ` + 치환된 문장(+ 링크 자동 부착)이 문자로 나간다. 없으면 기존 고정 문구 그대로.
 *  - 90바이트 초과는 LMS(제목 포함)로 명시, 이하는 SMS.
 *  - 푸시는 sendPushToUser 가 읽은 설정 행의 extra_config.message 를 쓰고, noOverride 면 적용하지 않는다.
 */

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k', FIREBASE_ADMIN_CLIENT_EMAIL: 'x', FIREBASE_ADMIN_PRIVATE_KEY: 'x' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://t.supabase.co', PUBLIC_FIREBASE_PROJECT_ID: 'p' }))
vi.mock('$env/dynamic/private', () => ({ env: { SOLAPI_API_KEY: 'a', SOLAPI_API_SECRET: 'b', SMS_SENDER_PHONE: '0212345678' } }))
vi.mock('$app/environment', () => ({ dev: false }))

const mockSend = vi.hoisted(() => vi.fn())
vi.mock('solapi', () => ({ SolapiMessageService: vi.fn().mockImplementation(function () { return { send: mockSend } }) }))
vi.mock('firebase-admin/app', () => ({ cert: vi.fn(), getApps: () => [], initializeApp: vi.fn() }))
vi.mock('$lib/server/crazychat/action', () => ({ AGENT_REQUEST_KIND_LABEL: {} }))
vi.mock('$lib/server/adminPushMenuFilter', () => ({ filterAdminPushRecipientsByMenu: async (_c: unknown, _k: string, ids: string[]) => ids }))

// 푸시 경로용 — FCM 발송 내용을 캡처
const fcmSend = vi.hoisted(() => vi.fn())
vi.mock('firebase-admin/messaging', () => ({ getMessaging: () => ({ sendEachForMulticast: fcmSend }) }))

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
    if (table === 'rental_reservations') return { data: { user_id: 'u1', reservation_code: 'CS2610001', start_date: '2026-10-12', end_date: '2026-10-14', pickup_time: '14:00', return_time: '14:00', products: { name: '소니 FX3', parent_product_id: null } }, error: null }
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

import { sendReservationLifecyclePush, sendCardSms, sendPushToUser } from '$lib/server/push'
import { clearNotifyMessageCache } from '$lib/server/notifyMessages'

beforeEach(() => {
  vi.clearAllMocks()
  clearNotifyMessageCache()
  cfgByType = {}
  mockSend.mockResolvedValue({ failedMessageList: [] })
  fcmSend.mockResolvedValue({ responses: [{ success: true }] })
})

describe('허브 문자 — 편집 문장 적용', () => {
  it('편집값이 없으면 기존 고정 문구 그대로', async () => {
    await sendReservationLifecyclePush(fakeClient(), 501, 'return_remind')
    const arg = mockSend.mock.calls[0][0] as { text: string; type: string }
    expect(arg.text).toContain('반납예정일이 다가와요')
    expect(arg.type).toBe('LMS') // 기본 문구+링크는 90바이트를 넘는다 — 이전엔 Solapi 자동 판별, 이제 명시
  })

  it('편집값이 있으면 [크레이지샷] + 치환 문장 + 링크가 나간다', async () => {
    cfgByType.return_remind = { message: '{{고객이름}}님 {{상품명}} 반납은 {{반납일시}}까지예요.', push_enabled: true }
    await sendReservationLifecyclePush(fakeClient(), 501, 'return_remind')
    const arg = mockSend.mock.calls[0][0] as { text: string }
    expect(arg.text.startsWith('[크레이지샷] 홍길동님 소니 FX3 반납은 2026-10-14 14:00까지예요.')).toBe(true)
    expect(arg.text).toContain('https://crazyshot.kr/account/rental/501/history')
  })

  it('90바이트를 넘으면 LMS + 제목으로 명시된다', async () => {
    cfgByType.return_remind = { message: '{{상품명}} 반납 안내입니다. 반납 방법과 장소, 영업시간을 반드시 확인해 주세요. 늦으면 연체료가 발생할 수 있어요.', push_enabled: true }
    await sendReservationLifecyclePush(fakeClient(), 501, 'return_remind')
    const arg = mockSend.mock.calls[0][0] as { type: string; subject?: string }
    expect(arg.type).toBe('LMS')
    expect(arg.subject).toBe('[크레이지샷]')
  })
})

describe('푸시 — 편집 문장 적용', () => {
  it('편집값이 있으면 FCM 본문이 치환된 문장이 된다', async () => {
    cfgByType.late_fee_paid = { message: '연체료 {{연체료}} 결제 감사합니다.', push_enabled: true }
    await sendPushToUser('u1', 'late_fee_paid', { title: 't', body: '기본', link: '/' }, { vars: { 연체료: '12,000원' } })
    const msg = fcmSend.mock.calls[0][0] as { webpush: { notification: { body: string } } }
    expect(msg.webpush.notification.body).toBe('연체료 12,000원 결제 감사합니다.')
  })

  it('편집값이 없으면 호출부가 넘긴 기본 본문 그대로', async () => {
    await sendPushToUser('u1', 'late_fee_paid', { title: 't', body: '기본 본문', link: '/' }, { vars: { 연체료: '12,000원' } })
    const msg = fcmSend.mock.calls[0][0] as { webpush: { notification: { body: string } } }
    expect(msg.webpush.notification.body).toBe('기본 본문')
  })

  it('noOverride 면 편집값이 있어도 적용하지 않는다', async () => {
    cfgByType.contract_signed_customer = { message: '서명 완료!', push_enabled: true }
    await sendPushToUser('u1', 'contract_signed_customer', { title: 't', body: '재공유 본문', link: '/' }, { noOverride: true })
    const msg = fcmSend.mock.calls[0][0] as { webpush: { notification: { body: string } } }
    expect(msg.webpush.notification.body).toBe('재공유 본문')
  })

  it('치환 결과가 비면 기본 본문으로 되돌린다', async () => {
    cfgByType.admin_chat_reply = { message: '{{답변내용}}', push_enabled: true }
    await sendPushToUser('u1', 'admin_chat_reply', { title: 't', body: '기본 본문', link: '/' })
    const msg = fcmSend.mock.calls[0][0] as { webpush: { notification: { body: string } } }
    expect(msg.webpush.notification.body).toBe('기본 본문')
  })
})

describe('카드 문자 — 설정 유형 매핑', () => {
  it('contract_link 문자는 contract_sent 편집값을 쓴다', async () => {
    cfgByType.contract_sent = { message: '계약서에 서명해 주세요.', push_enabled: true }
    await sendCardSms(fakeClient(), { userId: 'u1', reservationId: 501, notifyType: 'contract_link', link: 'https://crazyshot.kr/contract/abc', force: true })
    const arg = mockSend.mock.calls[0][0] as { text: string }
    expect(arg.text.startsWith('[크레이지샷] 계약서에 서명해 주세요.')).toBe(true)
    expect(arg.text).toContain('https://crazyshot.kr/contract/abc')
  })

  it('contract_reshare 는 편집값이 있어도 고정 문구 유지', async () => {
    cfgByType.contract_signed_customer = { message: '서명 완료!', push_enabled: true }
    await sendCardSms(fakeClient(), { userId: 'u1', reservationId: 501, notifyType: 'contract_reshare', force: true })
    const arg = mockSend.mock.calls[0][0] as { text: string }
    expect(arg.text).toContain('전자계약서를 다시 확인해주세요.')
  })
})
