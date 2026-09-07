import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TDD — maybeAutoAdvanceOnDheroDelivered 자동전이 함수 검증
 *
 * 대상: src/lib/server/dheroAutoAdvance.ts
 *
 * 케이스:
 *   1. statusCode !== 5 → 전이 없음 (배송완료 아닌 상태)
 *   2. direction='pickup', statusCode=5, currentStatus='shipped' → in_use로 자동전이 + rental_confirm 알림
 *   3. EC-1: currentStatus가 이미 'in_use' → 스킵 (멱등)
 *   4. EC-2: DB 재확인 시 status가 이미 'in_use'로 바뀜 → 스킵 (경쟁조건 방어)
 *   5. direction='return', statusCode=5, currentStatus='return_requested' → returned 자동전이 + rental_complete 알림
 *   6. EC-3: direction='return', currentStatus='in_use' → 스킵 (반납접수 자체가 안 된 상태)
 *   7. update_reservation_status RPC 실패 → fail-soft (외부에 throw 안 함)
 *   8. 채팅알림 발송 실패 → fail-soft (전이 결과는 유지)
 *   9. [CMS 전역 정밀검증 v6 CRITICAL #4] newStatus==='returned' → awardRentalCompletePoints
 *      호출(포인트 적립) — rentalQrTransition.ts:69-71과 동일 패턴. 현재 코드는 이 호출이
 *      누락돼 있어 두발히어로 자동반납 경로에서만 포인트가 빠지는 결함이 있었음.
 *  10. newStatus==='in_use'(반출 leg) → awardRentalCompletePoints 미호출(반납 완료가 아니므로)
 *
 * cron 연동 케이스:
 *   C-1. tracking_number 있는 예약 동기화 후 direction='pickup'으로 자동전이 함수 호출
 *   C-2. dhero_return_book_id 있는 예약도 조회해서 direction='return'으로 자동전이 함수 호출
 *   C-3. EC-3: dhero_return_book_id 조회 결과가 배송완료(5)인데 예약 status가 'in_use' → 스킵
 */

// ── 모킹 ───────────────────────────────────────────────────────────────────

vi.mock('$env/dynamic/private', () => ({
  env: {
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    DHERO_API_BASE_URL: 'https://partner-api.dev.dhero.kr',
    DHERO_TOKEN: 'test-token',
    DHERO_SPOT_CODE: 'TEST-SPOT',
    CRON_SECRET: 'test-cron-secret',
  },
}))
vi.mock('$env/static/private', () => ({
  SUPABASE_SERVICE_ROLE_KEY: 'test-key',
}))
vi.mock('$env/static/public', () => ({
  PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
}))

// push 모킹
const mockSendPush = vi.fn()
vi.mock('$lib/server/push', () => ({
  sendReservationLifecyclePush: (...args: unknown[]) => mockSendPush(...args),
}))

// 포인트 적립 모킹 (CMS 전역 정밀검증 v6 CRITICAL #4)
const mockAwardPoints = vi.fn()
vi.mock('$lib/server/awardRentalCompletePoints', () => ({
  awardRentalCompletePoints: (...args: unknown[]) => mockAwardPoints(...args),
}))

// rentalTransition — 실제 로직 그대로 사용 (mock 안 함)
// nextStatus('shipped', ...) = 'in_use'
// nextStatus('return_requested', ...) = 'returned'

// ── 공통 admin mock 빌더 ────────────────────────────────────────────────────

function makeAdmin({
  freshStatus = 'shipped' as string | null,  // DB 재확인 시 반환할 status
  rpcOk = true,
}: {
  freshStatus?: string | null
  rpcOk?: boolean
} = {}) {
  const mockRpc = vi.fn()
  mockRpc.mockImplementation((fn: string) => {
    if (fn === 'update_reservation_status') {
      return Promise.resolve({
        data: rpcOk ? { ok: true } : { ok: false, error: '이미 처리됨' },
        error: null,
      })
    }
    if (fn === 'send_rental_chat_notification') {
      return Promise.resolve({ data: null, error: null })
    }
    return Promise.resolve({ data: null, error: null })
  })

  const mockFrom = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: freshStatus !== null
        ? { status: freshStatus, pickup_method: 'crazydelivery', return_method: 'crazydelivery' }
        : null,
      error: null,
    }),
  })

  return { rpc: mockRpc, from: mockFrom, _mockRpc: mockRpc }
}

// ── 테스트 ──────────────────────────────────────────────────────────────────

describe('maybeAutoAdvanceOnDheroDelivered', () => {
  beforeEach(() => {
    mockSendPush.mockReset()
    mockAwardPoints.mockReset()
  })

  it('케이스 1 — statusCode가 5가 아니면 전이 없음', async () => {
    const admin = makeAdmin()
    const { maybeAutoAdvanceOnDheroDelivered } = await import('$lib/server/dheroAutoAdvance')

    await maybeAutoAdvanceOnDheroDelivered(admin, 100, 'pickup', 4, 'crazydelivery', null, 'shipped')

    // RPC 호출 없음
    expect(admin._mockRpc).not.toHaveBeenCalledWith('update_reservation_status', expect.anything())
  })

  it('케이스 2 — direction=pickup, statusCode=5, currentStatus=shipped → in_use로 전이 + rental_confirm 알림', async () => {
    const admin = makeAdmin({ freshStatus: 'shipped' })
    const { maybeAutoAdvanceOnDheroDelivered } = await import('$lib/server/dheroAutoAdvance')

    await maybeAutoAdvanceOnDheroDelivered(admin, 200, 'pickup', 5, 'crazydelivery', null, 'shipped')

    expect(admin._mockRpc).toHaveBeenCalledWith('update_reservation_status', {
      p_reservation_id: 200,
      p_new_status: 'in_use',
    })
    expect(admin._mockRpc).toHaveBeenCalledWith('send_rental_chat_notification', expect.objectContaining({
      p_reservation_id: 200,
      p_notify_type: 'rental_confirm',
    }))
  })

  it('케이스 3 — EC-1: currentStatus가 이미 in_use → 스킵 (멱등)', async () => {
    const admin = makeAdmin()
    const { maybeAutoAdvanceOnDheroDelivered } = await import('$lib/server/dheroAutoAdvance')

    await maybeAutoAdvanceOnDheroDelivered(admin, 300, 'pickup', 5, 'crazydelivery', null, 'in_use')

    expect(admin._mockRpc).not.toHaveBeenCalledWith('update_reservation_status', expect.anything())
  })

  it('케이스 4 — EC-2: DB 재확인 시 status가 이미 in_use로 바뀜 → 스킵 (경쟁조건 방어)', async () => {
    // freshStatus = 'in_use' (다른 트랜잭션이 이미 전이함)
    const admin = makeAdmin({ freshStatus: 'in_use' })
    const { maybeAutoAdvanceOnDheroDelivered } = await import('$lib/server/dheroAutoAdvance')

    await maybeAutoAdvanceOnDheroDelivered(admin, 400, 'pickup', 5, 'crazydelivery', null, 'shipped')

    expect(admin._mockRpc).not.toHaveBeenCalledWith('update_reservation_status', expect.anything())
  })

  it('케이스 5 — direction=return, statusCode=5, currentStatus=return_requested → returned + rental_complete', async () => {
    const admin = makeAdmin({ freshStatus: 'return_requested' })
    const { maybeAutoAdvanceOnDheroDelivered } = await import('$lib/server/dheroAutoAdvance')

    await maybeAutoAdvanceOnDheroDelivered(admin, 500, 'return', 5, null, 'crazydelivery', 'return_requested')

    expect(admin._mockRpc).toHaveBeenCalledWith('update_reservation_status', {
      p_reservation_id: 500,
      p_new_status: 'returned',
    })
    expect(admin._mockRpc).toHaveBeenCalledWith('send_rental_chat_notification', expect.objectContaining({
      p_reservation_id: 500,
      p_notify_type: 'rental_complete',
    }))
  })

  it('케이스 6 — EC-3: direction=return, currentStatus=in_use → 스킵', async () => {
    const admin = makeAdmin()
    const { maybeAutoAdvanceOnDheroDelivered } = await import('$lib/server/dheroAutoAdvance')

    await maybeAutoAdvanceOnDheroDelivered(admin, 600, 'return', 5, null, 'crazydelivery', 'in_use')

    expect(admin._mockRpc).not.toHaveBeenCalledWith('update_reservation_status', expect.anything())
  })

  it('케이스 7 — RPC 실패 시 fail-soft (throw 안 함)', async () => {
    const admin = makeAdmin({ freshStatus: 'shipped', rpcOk: false })
    const { maybeAutoAdvanceOnDheroDelivered } = await import('$lib/server/dheroAutoAdvance')

    // 예외가 밖으로 나오지 않아야 함
    await expect(
      maybeAutoAdvanceOnDheroDelivered(admin, 700, 'pickup', 5, 'crazydelivery', null, 'shipped')
    ).resolves.not.toThrow()
  })

  it('케이스 8 — 채팅알림 발송 실패 시 fail-soft', async () => {
    const admin = makeAdmin({ freshStatus: 'shipped' })
    // send_rental_chat_notification에서 throw
    admin._mockRpc.mockImplementation((fn: string) => {
      if (fn === 'update_reservation_status') return Promise.resolve({ data: { ok: true }, error: null })
      if (fn === 'send_rental_chat_notification') return Promise.reject(new Error('알림 실패'))
      return Promise.resolve({ data: null, error: null })
    })

    const { maybeAutoAdvanceOnDheroDelivered } = await import('$lib/server/dheroAutoAdvance')

    await expect(
      maybeAutoAdvanceOnDheroDelivered(admin, 800, 'pickup', 5, 'crazydelivery', null, 'shipped')
    ).resolves.not.toThrow()

    // 전이는 성공적으로 호출됨
    expect(admin._mockRpc).toHaveBeenCalledWith('update_reservation_status', expect.objectContaining({
      p_new_status: 'in_use',
    }))
  })

  it('RED → GREEN: 케이스 9 — direction=return 완료(returned) 시 awardRentalCompletePoints 호출해야 한다', async () => {
    const admin = makeAdmin({ freshStatus: 'return_requested' })
    const { maybeAutoAdvanceOnDheroDelivered } = await import('$lib/server/dheroAutoAdvance')

    await maybeAutoAdvanceOnDheroDelivered(admin, 900, 'return', 5, null, 'crazydelivery', 'return_requested')

    // RED: 현재 dheroAutoAdvance.ts는 이 호출이 없어 실패함
    // GREEN: rentalQrTransition.ts:69-71과 동일하게 newStatus==='returned' 시 호출
    expect(mockAwardPoints).toHaveBeenCalledWith(admin, 900)
  })

  it('케이스 10 — direction=pickup(in_use 전이) 시 awardRentalCompletePoints 미호출', async () => {
    const admin = makeAdmin({ freshStatus: 'shipped' })
    const { maybeAutoAdvanceOnDheroDelivered } = await import('$lib/server/dheroAutoAdvance')

    await maybeAutoAdvanceOnDheroDelivered(admin, 1000, 'pickup', 5, 'crazydelivery', null, 'shipped')

    expect(mockAwardPoints).not.toHaveBeenCalled()
  })

  it('케이스 11 — awardRentalCompletePoints 실패 시 fail-soft(throw 안 함, 알림은 정상 발송)', async () => {
    const admin = makeAdmin({ freshStatus: 'return_requested' })
    mockAwardPoints.mockRejectedValue(new Error('포인트 적립 실패'))
    const { maybeAutoAdvanceOnDheroDelivered } = await import('$lib/server/dheroAutoAdvance')

    await expect(
      maybeAutoAdvanceOnDheroDelivered(admin, 1100, 'return', 5, null, 'crazydelivery', 'return_requested')
    ).resolves.not.toThrow()

    expect(admin._mockRpc).toHaveBeenCalledWith('send_rental_chat_notification', expect.objectContaining({
      p_reservation_id: 1100,
      p_notify_type: 'rental_complete',
    }))
  })
})

// ── cron 연동 테스트는 별도 파일로 분리 ─────────────────────────────────────
// src/__tests__/server/dheroSyncCron.test.ts 참조
// 이유: vi.mock('$lib/server/dheroAutoAdvance', ...) 가 파일 최상위에 있으면
//      vi.mock은 호이스팅되어 위 function 단위 테스트에도 적용돼버림 (caching 충돌)
