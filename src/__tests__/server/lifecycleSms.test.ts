import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TDD RED — 예약·대여 대화카드 발송 시 SMS 동시 발송 허브 (2026-10-02)
 *
 * 완료기준(B-START):
 *   정상 동작   : 10종 notify_type 대화카드 발송 시 SMS가 동시에 발송된다.
 *   막아야 할 것 : 전화번호 없음 / withdrawal('requested'|'purged') / dev 환경 / 동일날 중복
 *                (force·contract_link 예외). allow_rental_alert=false여도 발송 / 블랙리스트여도 발송.
 *                locker_guide는 허브 스킵(자체 SMS 있음).
 *   실패했을 때  : SMS 실패가 메인 흐름(채팅카드)에 영향 없음(fail-soft).
 *
 * 대상: src/lib/server/sms.ts sendLifecycleSms + LIFECYCLE_SMS_COPY
 */

// ── 환경변수 모킹 ───────────────────────────────────────────────────────────
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key' }))
vi.mock('$env/static/public',  () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))
vi.mock('$env/dynamic/private', () => ({
  env: {
    SOLAPI_API_KEY:    'test-api-key',
    SOLAPI_API_SECRET: 'test-api-secret',
    SMS_SENDER_PHONE:  '0212345678',
  },
}))

// ── Solapi SDK 모킹 — 실제 HTTP 호출 차단 ───────────────────────────────────
const mockSend = vi.fn().mockResolvedValue({ failedMessageList: [] })
vi.mock('solapi', () => ({
  SolapiMessageService: vi.fn().mockImplementation(function () { return { send: mockSend } }),
}))

// ── dev 환경 플래그 ─────────────────────────────────────────────────────────
const envModule = vi.hoisted(() => ({ dev: false }))
vi.mock('$app/environment', () => envModule)

// ── DB 상태 (withdrawal + dedup log) ───────────────────────────────────────
interface DbState {
  withdrawalStatus: string | null // 'none' | 'requested' | 'purged' | null
  hasExistingLog:   boolean        // true = 동일날 중복 존재
}
let dbState: DbState = { withdrawalStatus: 'none', hasExistingLog: false }

/**
 * admin SupabaseClient 최소 모킹
 * - user_profiles: withdrawal_status 조회
 * - sms_notification_logs: 중복 조회 + 신규 insert
 */
function makeAdminMock() {
  const insertMock = vi.fn().mockResolvedValue({ data: null, error: null })

  const from = vi.fn((table: string) => {
    const filters: Record<string, unknown> = {}
    let selectCols = ''
    const builder: Record<string, unknown> = {}

    builder.select = (cols: string) => { selectCols = cols; return builder }
    builder.eq     = (k: string, v: unknown) => { filters[k] = v; return builder }
    builder.in     = (k: string, v: unknown) => { filters[k] = v; return builder }
    builder.is     = () => builder
    builder.limit  = () => builder
    builder.gte    = () => builder
    builder.lt     = () => builder
    builder.lte    = () => builder

    builder.maybeSingle = async (): Promise<{ data: unknown; error: null }> => {
      if (table === 'user_profiles' && selectCols.includes('withdrawal_status')) {
        return {
          data: { withdrawal_status: dbState.withdrawalStatus ?? 'none' },
          error: null,
        }
      }
      if (table === 'sms_notification_logs') {
        return {
          data: dbState.hasExistingLog ? { id: 99, status: 'sent' } : null,
          error: null,
        }
      }
      return { data: null, error: null }
    }

    if (table === 'sms_notification_logs') {
      builder.insert = insertMock
    }

    return builder
  })

  return { from, insertMock }
}

// ── 테스트 대상 import ──────────────────────────────────────────────────────
// NOTE: sendLifecycleSms / LIFECYCLE_SMS_COPY 는 아직 미구현 → TDD RED: import 이후 호출 시 실패
import { sendLifecycleSms, LIFECYCLE_SMS_COPY } from '$lib/server/sms'

// ────────────────────────────────────────────────────────────────────────────

const BASE_PARAMS = {
  phone:         '01099999999',
  userId:        'user-uuid-001',
  productName:   '소니 FX3',
  reservationId: 1001,
} as const

describe('sendLifecycleSms — 예약·대여 라이프사이클 SMS 동시 발송 허브', () => {
  let adminMock: ReturnType<typeof makeAdminMock>

  beforeEach(() => {
    vi.clearAllMocks()
    envModule.dev    = false
    dbState          = { withdrawalStatus: 'none', hasExistingLog: false }
    adminMock        = makeAdminMock()
    mockSend.mockResolvedValue({ failedMessageList: [] })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // TC-1: LIFECYCLE_SMS_COPY 에 9종이 등록돼 있어야 하고 locker_guide 는 제외
  // ──────────────────────────────────────────────────────────────────────────
  it('TC-1: LIFECYCLE_SMS_COPY가 9종을 포함하고 locker_guide는 제외함', () => {
    const expectedTypes = [
      'contract_link',
      'contract_signed',
      'reservation_approval',
      'shipment_notify',
      'tracking_notify',
      'dhero_place_guide',
      'return_registration',
      'return_remind',
      'reservation_cancelled',
    ]
    for (const t of expectedTypes) {
      expect(
        LIFECYCLE_SMS_COPY,
        `LIFECYCLE_SMS_COPY에 '${t}'가 없습니다`,
      ).toHaveProperty(t)
    }
    // locker_guide 는 자체 도어코드 SMS 가 있으므로 허브 제외
    expect(LIFECYCLE_SMS_COPY).not.toHaveProperty('locker_guide')
  })

  // ──────────────────────────────────────────────────────────────────────────
  // TC-2: 정상 발송 — reservation_approval
  // ──────────────────────────────────────────────────────────────────────────
  it('TC-2: reservation_approval → Solapi.send 호출되고 sent:true 반환', async () => {
    const result = await sendLifecycleSms(adminMock as never, {
      ...BASE_PARAMS,
      notifyType: 'reservation_approval',
    })

    expect(result.sent).toBe(true)
    expect(mockSend).toHaveBeenCalledOnce()

    const sentText = (mockSend.mock.calls[0][0] as { text: string }).text
    expect(sentText).toContain('크레이지샷')
    expect(sentText).toContain('소니 FX3')
  })

  // ──────────────────────────────────────────────────────────────────────────
  // TC-3: 전화번호 없으면 스킵
  // ──────────────────────────────────────────────────────────────────────────
  it('TC-3: phone 빈 문자열 → SMS 스킵 (reason: no_phone)', async () => {
    const result = await sendLifecycleSms(adminMock as never, {
      ...BASE_PARAMS,
      phone:      '',
      notifyType: 'reservation_approval',
    })

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('no_phone')
    expect(mockSend).not.toHaveBeenCalled()
  })

  // ──────────────────────────────────────────────────────────────────────────
  // TC-4: withdrawal_status='requested' → 스킵
  // ──────────────────────────────────────────────────────────────────────────
  it('TC-4: withdrawal_status=requested → SMS 스킵 (reason: withdrawn)', async () => {
    dbState.withdrawalStatus = 'requested'

    const result = await sendLifecycleSms(adminMock as never, {
      ...BASE_PARAMS,
      notifyType: 'shipment_notify',
    })

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('withdrawn')
    expect(mockSend).not.toHaveBeenCalled()
  })

  // ──────────────────────────────────────────────────────────────────────────
  // TC-5: withdrawal_status='purged' → 스킵
  // ──────────────────────────────────────────────────────────────────────────
  it('TC-5: withdrawal_status=purged → SMS 스킵 (reason: withdrawn)', async () => {
    dbState.withdrawalStatus = 'purged'

    const result = await sendLifecycleSms(adminMock as never, {
      ...BASE_PARAMS,
      notifyType: 'shipment_notify',
    })

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('withdrawn')
    expect(mockSend).not.toHaveBeenCalled()
  })

  // ──────────────────────────────────────────────────────────────────────────
  // TC-6: 블랙리스트·allow_rental_alert=false 여도 SMS 발송됨
  //       → DB 모킹이 이 두 필드를 전혀 조회하지 않는 구조여야 함을 검증
  //       → withdrawal 만 'none'이면 정상 발송
  // ──────────────────────────────────────────────────────────────────────────
  it('TC-6: 블랙리스트·allow_rental_alert=false 무관 → SMS 발송됨', async () => {
    // DB 조회 체인이 is_blacklisted / allow_rental_alert 를 보면
    // maybeSingle 결과에 영향이 없어야 한다(withdrawal만 체크)
    const result = await sendLifecycleSms(adminMock as never, {
      ...BASE_PARAMS,
      notifyType: 'return_registration',
    })

    expect(result.sent).toBe(true)
    expect(mockSend).toHaveBeenCalledOnce()

    // from() 호출에서 is_blacklisted / allow_rental_alert 를 eq/is로 필터링하지 않아야 함
    const fromCalls = adminMock.from.mock.calls.flat() as string[]
    for (const call of fromCalls) {
      expect(typeof call === 'string' && call).not.toContain('blacklist')
      expect(typeof call === 'string' && call).not.toContain('allow_rental_alert')
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // TC-7: 동일날 중복 — 두 번째 호출은 스킵
  // ──────────────────────────────────────────────────────────────────────────
  it('TC-7: 동일날 동일 (reservationId, notifyType) 중복 → 스킵 (reason: duplicate)', async () => {
    dbState.hasExistingLog = true

    const result = await sendLifecycleSms(adminMock as never, {
      ...BASE_PARAMS,
      notifyType: 'reservation_approval',
    })

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('duplicate')
    expect(mockSend).not.toHaveBeenCalled()
  })

  // ──────────────────────────────────────────────────────────────────────────
  // TC-8: force=true 이면 중복이어도 발송
  // ──────────────────────────────────────────────────────────────────────────
  it('TC-8: force=true → 중복이어도 contract_link SMS 발송됨', async () => {
    dbState.hasExistingLog = true

    const result = await sendLifecycleSms(adminMock as never, {
      ...BASE_PARAMS,
      notifyType: 'contract_link',
      force:      true,
    })

    expect(result.sent).toBe(true)
    expect(mockSend).toHaveBeenCalledOnce()
    const sentText = (mockSend.mock.calls[0][0] as { text: string }).text
    expect(sentText).toContain('크레이지샷')
  })

  // ──────────────────────────────────────────────────────────────────────────
  // TC-9: dev=true 환경 → sendSms(Solapi) 호출 안 함, reason: dev
  // ──────────────────────────────────────────────────────────────────────────
  it('TC-9: dev=true 환경에서는 Solapi 호출 없이 reason:dev 반환', async () => {
    envModule.dev = true

    const result = await sendLifecycleSms(adminMock as never, {
      ...BASE_PARAMS,
      notifyType: 'reservation_approval',
    })

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('dev')
    expect(mockSend).not.toHaveBeenCalled()
  })

  // ──────────────────────────────────────────────────────────────────────────
  // TC-10: locker_guide → 허브에서 스킵 (LIFECYCLE_SMS_COPY 미등록)
  // ──────────────────────────────────────────────────────────────────────────
  it('TC-10: locker_guide는 허브 SMS 스킵 (reason: no_copy)', async () => {
    const result = await sendLifecycleSms(adminMock as never, {
      ...BASE_PARAMS,
      notifyType: 'locker_guide',
    })

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('no_copy')
    expect(mockSend).not.toHaveBeenCalled()
  })
})
