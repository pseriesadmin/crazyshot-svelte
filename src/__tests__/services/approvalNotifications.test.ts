import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * NTF-C2 + NTF-C3 — 승인 알림 게이팅 · 5개 발신지점 채팅↔푸시 동기화 (TDD)
 * Harness Flow v3.2 — RED → GREEN → REFACTOR
 *
 * 대상: src/lib/server/sendApprovalNotifications.ts (신규 공용 헬퍼)
 *
 * 정합기준(GATE B Q1/Q4, EC-2/EC-3):
 *   EC-2: mode='hold' → 채팅카드·푸시 둘 다 미발송 (묶음주문 A 확정 시, B 아직 미확정)
 *   EC-3: mode='single' / 'batch' → 채팅카드 발송 후 동일 조건으로 푸시도 발송
 *         (sign/+server.ts NTF-C3 공백 포함 — 이 헬퍼가 sign 경로에 적용됐을 때도 동작)
 *
 * 핵심 불변식:
 *   "채팅카드 발송이 보류(mode==='hold')인데 푸시만 별도 경로로 나가지 않는다"
 *   = sendReservationLifecyclePush가 mode='hold' 시 절대 호출되지 않아야 한다.
 */

// ── 모듈 모킹 ────────────────────────────────────────────────────────────────
// push 모듈: sendReservationLifecyclePush 스파이
const pushSpy = vi.fn().mockResolvedValue(undefined)
vi.mock('$lib/server/push', () => ({
  sendReservationLifecyclePush: pushSpy,
  sendPaymentCompletedAdminPush: vi.fn().mockResolvedValue(undefined),
}))

// $env/static/private — push.ts 내부에서 직접 읽는 환경변수
vi.mock('$env/static/private', () => ({
  FIREBASE_ADMIN_CLIENT_EMAIL: 'test@example.com',
  FIREBASE_ADMIN_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
}))

vi.mock('$env/static/public', () => ({
  PUBLIC_FIREBASE_PROJECT_ID: 'test-project',
  PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
}))

// vi.mock는 호이스팅 — 대상 모듈을 동적 import로 가져옴
const { sendApprovalNotifications } = await import('$lib/server/sendApprovalNotifications')

// ── mock admin 클라이언트 팩토리 ──────────────────────────────────────────────
function makeMockAdmin() {
  return {
    rpc: vi.fn().mockResolvedValue({ data: { ok: true }, error: null }),
  }
}

// ── 테스트 ───────────────────────────────────────────────────────────────────
describe('sendApprovalNotifications — 공용 승인알림 헬퍼 (EC-2/EC-3)', () => {
  let admin: ReturnType<typeof makeMockAdmin>
  const RESERVATION_ID = 42

  beforeEach(() => {
    vi.clearAllMocks()
    admin = makeMockAdmin()
  })

  // ── EC-2: mode='hold' → 채팅·푸시 둘 다 미발송 ────────────────────────────
  it('EC-2: mode=hold → RPC 미호출, 푸시 미발송', async () => {
    await sendApprovalNotifications(
      admin as never,
      RESERVATION_ID,
      { mode: 'hold' },
    )

    expect(admin.rpc).not.toHaveBeenCalled()
    expect(pushSpy).not.toHaveBeenCalled()
  })

  // ── EC-3a: mode='single' → 단건 채팅 + 푸시 발송 ─────────────────────────
  it('EC-3a: mode=single → send_rental_chat_notification + reservation_approval 푸시', async () => {
    await sendApprovalNotifications(
      admin as never,
      RESERVATION_ID,
      { mode: 'single' },
    )

    expect(admin.rpc).toHaveBeenCalledWith('send_rental_chat_notification', {
      p_reservation_id: RESERVATION_ID,
      p_notify_type: 'reservation_approval',
    })
    expect(admin.rpc).toHaveBeenCalledTimes(1)
    expect(pushSpy).toHaveBeenCalledWith(
      admin,
      RESERVATION_ID,
      'reservation_approval',
    )
    expect(pushSpy).toHaveBeenCalledTimes(1)
  })

  // ── EC-3b: mode='batch' → 배치 채팅 + 푸시 발송 ──────────────────────────
  it('EC-3b: mode=batch → send_rental_chat_notification_batch + 푸시 발송', async () => {
    const RESERVATION_IDS = [42, 43]

    await sendApprovalNotifications(
      admin as never,
      RESERVATION_ID,
      { mode: 'batch', reservationIds: RESERVATION_IDS },
    )

    expect(admin.rpc).toHaveBeenCalledWith('send_rental_chat_notification_batch', {
      p_reservation_ids: RESERVATION_IDS,
      p_notify_type: 'reservation_approval',
    })
    expect(admin.rpc).toHaveBeenCalledTimes(1)
    expect(pushSpy).toHaveBeenCalledWith(
      admin,
      RESERVATION_ID,
      'reservation_approval',
    )
    expect(pushSpy).toHaveBeenCalledTimes(1)
  })

  // ── 불변식: 푸시 순서는 항상 채팅 이후 ──────────────────────────────────────
  it('푸시는 항상 채팅 RPC 이후에 호출됨 (mode=single)', async () => {
    const callOrder: string[] = []
    admin.rpc.mockImplementation(async () => {
      callOrder.push('chat')
      return { data: { ok: true }, error: null }
    })
    pushSpy.mockImplementation(async () => {
      callOrder.push('push')
    })

    await sendApprovalNotifications(
      admin as never,
      RESERVATION_ID,
      { mode: 'single' },
    )

    expect(callOrder).toEqual(['chat', 'push'])
  })
})
