import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Stage 3 — log_rental_action 재연결 TDD (EC-4)
 * Harness Flow v3.2 — RED → GREEN → REFACTOR
 *
 * 대상: src/lib/server/rentalQrTransition.ts (QR 경로)
 *       updateStatus form action (수동 경로) — 동일 RPC 패턴 검증
 *
 * 정합기준(GATE B Q5, EC-4):
 *   EC-4a: QR 스캔 반출 성공 시 log_rental_action RPC 호출됨
 *           (action_type=newStatus, p_note='qr_scan', p_admin_id=userId)
 *   EC-4b: update_reservation_status 실패 시 log_rental_action 미호출
 *   EC-4c: log_rental_action 실패해도 메인 흐름 ok:true 반환 (fail-soft)
 *   EC-4d: QR 경로 note='qr_scan' / 수동 경로 note='manual' 로 처리자 구분
 *
 * 핵심 불변식:
 *   두 경로 모두 동일 테이블(rental_action_logs)에 동일 컬럼 구조로 기록
 *   (action_type=newStatus, performed_by=adminId, note='qr_scan'|'manual')
 */

// ── 모듈 모킹 ────────────────────────────────────────────────────────────────
const pushSpy = vi.fn().mockResolvedValue(undefined)
vi.mock('$lib/server/push', () => ({
  sendReservationLifecyclePush: pushSpy,
}))

vi.mock('$env/static/private', () => ({
  SUPABASE_SERVICE_ROLE_KEY: 'test-key',
  FIREBASE_ADMIN_CLIENT_EMAIL: 'test@example.com',
  FIREBASE_ADMIN_PRIVATE_KEY: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
}))

vi.mock('$env/static/public', () => ({
  PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
  PUBLIC_FIREBASE_PROJECT_ID: 'test-project',
}))

const { processRentalQrTransition } = await import('$lib/server/rentalQrTransition')

// ── mock admin 팩토리 ─────────────────────────────────────────────────────────
function makeAdmin(statusOk = true) {
  return {
    rpc: vi.fn((fn: string) => {
      if (fn === 'update_reservation_status') {
        return Promise.resolve({
          data: statusOk ? { ok: true } : null,
          error: statusOk ? null : { message: 'RPC 오류' },
        })
      }
      // log_rental_action / send_rental_chat_notification / upsert_product_history_record
      return Promise.resolve({ data: { ok: true }, error: null })
    }),
  }
}

// ── 테스트 ────────────────────────────────────────────────────────────────────
describe('rentalActionLog — QR 경로 log_rental_action 연결 (EC-4)', () => {
  const RESERVATION_ID = 100
  const PRODUCT_ID = 'prod-uuid'
  const USER_ID = 'admin-uuid'
  const NEW_STATUS = 'shipped'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── EC-4a: 성공 시 log_rental_action 호출 ────────────────────────────────
  it('EC-4a: 상태전이 성공 시 log_rental_action 호출됨 (note=qr_scan)', async () => {
    const admin = makeAdmin(true)

    const result = await processRentalQrTransition(admin as never, {
      reservationId: RESERVATION_ID,
      newStatus: NEW_STATUS,
      productId: PRODUCT_ID,
      userId: USER_ID,
    })

    expect(result.ok).toBe(true)
    expect(admin.rpc).toHaveBeenCalledWith('log_rental_action', {
      p_reservation_id: RESERVATION_ID,
      p_action_type:    NEW_STATUS,
      p_admin_id:       USER_ID,
      p_note:           'qr_scan',
    })
  })

  // ── EC-4b: update_reservation_status 실패 시 log_rental_action 미호출 ─────
  it('EC-4b: 상태전이 실패 시 log_rental_action 미호출', async () => {
    const admin = makeAdmin(false)

    const result = await processRentalQrTransition(admin as never, {
      reservationId: RESERVATION_ID,
      newStatus: NEW_STATUS,
      productId: PRODUCT_ID,
      userId: USER_ID,
    })

    expect(result.ok).toBe(false)
    const logCalls = (admin.rpc as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === 'log_rental_action',
    )
    expect(logCalls).toHaveLength(0)
  })

  // ── EC-4c: log_rental_action 실패해도 메인 흐름 ok:true (fail-soft) ────────
  it('EC-4c: log_rental_action 실패해도 ok:true 반환 (fail-soft)', async () => {
    const admin = {
      rpc: vi.fn((fn: string) => {
        if (fn === 'update_reservation_status') {
          return Promise.resolve({ data: { ok: true }, error: null })
        }
        if (fn === 'log_rental_action') {
          return Promise.reject(new Error('DB 연결 오류'))
        }
        return Promise.resolve({ data: { ok: true }, error: null })
      }),
    }

    const result = await processRentalQrTransition(admin as never, {
      reservationId: RESERVATION_ID,
      newStatus: NEW_STATUS,
      productId: PRODUCT_ID,
      userId: USER_ID,
    })

    expect(result.ok).toBe(true)
    expect(result.newStatus).toBe(NEW_STATUS)
  })

  // ── EC-4d: QR 경로 note='qr_scan', 수동 경로 note='manual' 구조 검증 ──────
  it('EC-4d: QR 경로는 note=qr_scan 으로 처리자 구분', async () => {
    const admin = makeAdmin(true)

    await processRentalQrTransition(admin as never, {
      reservationId: RESERVATION_ID,
      newStatus: 'in_use',
      productId: PRODUCT_ID,
      userId: USER_ID,
    })

    const logCall = (admin.rpc as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === 'log_rental_action',
    )
    expect(logCall).toBeDefined()
    expect(logCall![1]).toMatchObject({
      p_action_type: 'in_use',
      p_note:        'qr_scan',
      p_admin_id:    USER_ID,
    })
  })
})
