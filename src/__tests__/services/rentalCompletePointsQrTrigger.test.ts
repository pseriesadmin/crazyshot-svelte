import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 대여완료(rental_complete) 포인트 자동적립 — QR 반납 경로 배선 검증
 * Harness Flow v3.2 — TDD (RED → GREEN)
 *
 * 대상: src/lib/server/rentalQrTransition.ts (processRentalQrTransition)
 *
 * 케이스:
 *   EC-1: newStatus === 'returned' 전이 성공 시 awardRentalCompletePoints 호출됨(예약ID 전달)
 *   EC-2: 'returned' 외 다른 상태 전이 시 awardRentalCompletePoints 미호출
 *   EC-3: update_reservation_status 실패 시 awardRentalCompletePoints 미호출
 *   EC-4: awardRentalCompletePoints 자체는 fail-soft 헬퍼이므로 실패해도 메인 흐름(ok:true) 영향 없음
 */

vi.mock('$lib/server/push', () => ({
  sendReservationLifecyclePush: vi.fn().mockResolvedValue(undefined),
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

const mockAward = vi.fn().mockResolvedValue(undefined)
vi.mock('$lib/server/awardRentalCompletePoints', () => ({
  awardRentalCompletePoints: (...args: unknown[]) => mockAward(...args),
}))

const { processRentalQrTransition } = await import('$lib/server/rentalQrTransition')

function makeAdmin() {
  return {
    rpc: vi.fn().mockResolvedValue({ data: { ok: true }, error: null }),
  }
}

describe('QR 반납 경로 — 대여완료 포인트 자동적립 배선', () => {
  const RESERVATION_ID = 3001
  // UUID_RE 검증 통과 → products.from() 조회 우회 (Bug 1 수정: product_code→UUID 분기가 UUID일 때 DB 조회 생략)
  const PRODUCT_ID = '550e8400-e29b-41d4-a716-446655440000'
  const USER_ID = 'admin-uuid'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('EC-1: returned 전이 성공 시 awardRentalCompletePoints(admin, reservationId) 호출됨', async () => {
    const admin = makeAdmin()

    const result = await processRentalQrTransition(admin as never, {
      reservationId: RESERVATION_ID,
      newStatus: 'returned',
      productId: PRODUCT_ID,
      userId: USER_ID,
    })

    expect(result.ok).toBe(true)
    expect(mockAward).toHaveBeenCalledWith(admin, RESERVATION_ID)
  })

  it('EC-2: returned 외 상태(shipped)에서는 awardRentalCompletePoints 미호출', async () => {
    const admin = makeAdmin()

    await processRentalQrTransition(admin as never, {
      reservationId: RESERVATION_ID,
      newStatus: 'shipped',
      productId: PRODUCT_ID,
      userId: USER_ID,
    })

    expect(mockAward).not.toHaveBeenCalled()
  })

  it('EC-3: update_reservation_status 실패 시 awardRentalCompletePoints 미호출', async () => {
    const admin = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'RPC 오류' } }),
    }

    const result = await processRentalQrTransition(admin as never, {
      reservationId: RESERVATION_ID,
      newStatus: 'returned',
      productId: PRODUCT_ID,
      userId: USER_ID,
    })

    expect(result.ok).toBe(false)
    expect(mockAward).not.toHaveBeenCalled()
  })

  it('EC-4: awardRentalCompletePoints 실패해도 ok:true 반환(fail-soft 헬퍼 신뢰)', async () => {
    mockAward.mockRejectedValueOnce(new Error('포인트 적립 실패'))
    const admin = makeAdmin()

    const result = await processRentalQrTransition(admin as never, {
      reservationId: RESERVATION_ID,
      newStatus: 'returned',
      productId: PRODUCT_ID,
      userId: USER_ID,
    })

    expect(result.ok).toBe(true)
  })
})
