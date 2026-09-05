import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TDD: 고객 셀프 "예약신청취소" (2026-09-06)
 * 결제완료건 실제 Toss 환불 포함 신설
 *
 * A. canCancelReservation() — 취소가능 순수 판정 함수
 * B. cancelReservationWithRefund() — Toss+RPC 공용 헬퍼
 * C. POST /api/checkout/cancel-reservation — 엔드포인트 인증·소유권·조건 검증
 */

// ────────────────────────────────────────────────────────────────────────────
// A. canCancelReservation — 순수 함수 (모킹 불필요)
// ────────────────────────────────────────────────────────────────────────────

describe('A. canCancelReservation — 취소가능 판정', () => {
  // 아직 구현 파일 없음 → import 실패하거나 함수 undefined → RED 확인
  it('CC-1 hold 상태는 항상 canCancel=true (배송 방식)', async () => {
    const { canCancelReservation } = await import('$lib/utils/canCancelReservation')
    expect(canCancelReservation({
      status: 'hold',
      trackingNumber: null,
      isDeliveryType: true,
      startDate: '2099-12-31',
      pickupTime: '10:00',
      nowMs: Date.now(),
    })).toBe(true)
  })

  it('CC-2 confirmed + 운송장 미등록 + 배송 방식 → canCancel=true', async () => {
    const { canCancelReservation } = await import('$lib/utils/canCancelReservation')
    expect(canCancelReservation({
      status: 'confirmed',
      trackingNumber: null,
      isDeliveryType: true,
      startDate: '2099-12-31',
      pickupTime: null,
      nowMs: Date.now(),
    })).toBe(true)
  })

  it('CC-3 confirmed + 운송장 등록됨 → canCancel=false', async () => {
    const { canCancelReservation } = await import('$lib/utils/canCancelReservation')
    expect(canCancelReservation({
      status: 'confirmed',
      trackingNumber: 'TRACK123',
      isDeliveryType: true,
      startDate: '2099-12-31',
      pickupTime: null,
      nowMs: Date.now(),
    })).toBe(false)
  })

  it('CC-4 confirmed + 비배송 + 방문 8시간 이전 → canCancel=true', async () => {
    const { canCancelReservation } = await import('$lib/utils/canCancelReservation')
    const startDate = '2099-06-15'
    const pickupTime = '14:00'
    // 8시간 이전이면 취소 가능
    const nowMs = new Date('2099-06-15T06:00:00').getTime() // 8h before 14:00
    expect(canCancelReservation({
      status: 'confirmed',
      trackingNumber: null,
      isDeliveryType: false,
      startDate,
      pickupTime,
      nowMs,
    })).toBe(true)
  })

  it('CC-5 confirmed + 비배송 + 방문 5시간 이내 → canCancel=false', async () => {
    const { canCancelReservation } = await import('$lib/utils/canCancelReservation')
    const startDate = '2099-06-15'
    const pickupTime = '14:00'
    // 5시간 이내(6시간 이내)이면 취소 불가
    const nowMs = new Date('2099-06-15T09:00:00').getTime() // 5h before 14:00
    expect(canCancelReservation({
      status: 'confirmed',
      trackingNumber: null,
      isDeliveryType: false,
      startDate,
      pickupTime,
      nowMs,
    })).toBe(false)
  })

  it('CC-6 배송 방식은 6시간 이내라도 → canCancel=true (시간 제약 없음)', async () => {
    const { canCancelReservation } = await import('$lib/utils/canCancelReservation')
    const startDate = '2099-06-15'
    const pickupTime = '14:00'
    const nowMs = new Date('2099-06-15T13:00:00').getTime() // 1h before
    expect(canCancelReservation({
      status: 'confirmed',
      trackingNumber: null,
      isDeliveryType: true,  // 배송
      startDate,
      pickupTime,
      nowMs,
    })).toBe(true)
  })

  it('CC-7 shipped/in_use 등 취소 불가 상태 → canCancel=false', async () => {
    const { canCancelReservation } = await import('$lib/utils/canCancelReservation')
    expect(canCancelReservation({
      status: 'shipped',
      trackingNumber: null,
      isDeliveryType: true,
      startDate: '2099-12-31',
      pickupTime: null,
      nowMs: Date.now(),
    })).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// B. cancelReservationWithRefund — Toss+RPC 헬퍼
// ────────────────────────────────────────────────────────────────────────────

// 환경 모킹 (헬퍼용)
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'svc-key' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))
vi.mock('$env/dynamic/private', () => ({ env: { TOSS_SECRET_KEY: 'toss-secret', SUPABASE_SERVICE_ROLE_KEY: 'svc-key' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://test.supabase.co' }))
vi.mock('$lib/server/push', () => ({
  sendPushToAdmins: vi.fn().mockResolvedValue(undefined),
  sendReservationLifecyclePush: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('$lib/server/dhero', () => ({
  cancelDelivery: vi.fn().mockResolvedValue(undefined),
  DheroApiError: class extends Error {
    statusCode: number
    constructor(msg: string, code: number) { super(msg); this.statusCode = code }
  },
}))

// Supabase client mock
const mockMaybeSingle = vi.fn()
const mockAdminRpc = vi.fn()
const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null })
const mockUpdateEq = vi.fn().mockResolvedValue({ data: null, error: null })
const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq })
const mockFrom = vi.fn().mockReturnValue({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  maybeSingle: mockMaybeSingle,
  update: mockUpdate,
  insert: mockInsert,
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: mockFrom,
    rpc: mockAdminRpc,
  }),
}))

// fetch mock (Toss API)
const mockFetch = vi.fn()
global.fetch = mockFetch as typeof global.fetch

describe('B. cancelReservationWithRefund — Toss+RPC 헬퍼', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('SC-9 payment_key 없음 → NOT_FOUND', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null })
    const { cancelReservationWithRefund } = await vi.importActual<typeof import('$lib/server/cancelReservationWithRefund')>('$lib/server/cancelReservationWithRefund')
    const result = await cancelReservationWithRefund({
      reservationId: 42,
      callerId: 'user-1',
      cancelReason: '고객 자가취소(예약신청취소)',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('NOT_FOUND')
  })

  it('SC-10 Toss 취소 API 실패 → TOSS_FAILED, DB 미변경', async () => {
    // payment_transactions 조회 → payment_key 있음
    mockMaybeSingle.mockResolvedValueOnce({
      data: { payment_key: 'pk-abc', status: 'done' },
      error: null,
    })
    // reservation status 조회 → confirmed
    mockMaybeSingle.mockResolvedValueOnce({
      data: { status: 'confirmed' },
      error: null,
    })
    // Toss API 실패
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ code: 'PAYMENT_NOT_FOUND', message: 'not found' }),
    })

    const { cancelReservationWithRefund } = await vi.importActual<typeof import('$lib/server/cancelReservationWithRefund')>('$lib/server/cancelReservationWithRefund')
    const result = await cancelReservationWithRefund({
      reservationId: 42,
      callerId: 'user-1',
      cancelReason: '고객 자가취소',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('TOSS_FAILED')
      expect(result.message).toBeTruthy()
    }
    // Toss 실패 → RPC 호출 안 됨
    expect(mockAdminRpc).not.toHaveBeenCalledWith('cancel_reservation_payment', expect.anything())
  })

  it('SC-11 Toss 성공 + RPC 성공 → ok:true', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { payment_key: 'pk-xyz', status: 'done' },
      error: null,
    })
    mockMaybeSingle.mockResolvedValueOnce({
      data: { status: 'confirmed' },
      error: null,
    })
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ paymentKey: 'pk-xyz', status: 'CANCELED' }),
    })
    mockAdminRpc.mockImplementation((fn: string) => {
      if (fn === 'cancel_reservation_payment') {
        return Promise.resolve({
          data: { success: true, cancelled_reservation_ids: [42] },
          error: null,
        })
      }
      // send_rental_chat_notification etc.
      return Promise.resolve({ data: null, error: null })
    })

    const { cancelReservationWithRefund } = await vi.importActual<typeof import('$lib/server/cancelReservationWithRefund')>('$lib/server/cancelReservationWithRefund')
    const result = await cancelReservationWithRefund({
      reservationId: 42,
      callerId: 'user-1',
      cancelReason: '고객 자가취소',
    })

    expect(result.ok).toBe(true)
  })

  it('SC-12 Toss 성공 + RPC 3회 실패 → RPC_FAILED + fail-soft (관리자 알림)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { payment_key: 'pk-fail', status: 'done' },
      error: null,
    })
    mockMaybeSingle.mockResolvedValueOnce({
      data: { status: 'confirmed' },
      error: null,
    })
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ paymentKey: 'pk-fail', status: 'CANCELED' }),
    })
    // RPC 3회 전부 실패 (cancel_reservation_payment)
    // find_or_create_general_chat_session은 세션 ID 반환 → chat_messages.insert 호출 가능
    mockAdminRpc.mockImplementation((fn: string) => {
      if (fn === 'cancel_reservation_payment') {
        return Promise.resolve({ data: { success: false, error: 'DB error' }, error: null })
      }
      if (fn === 'find_or_create_general_chat_session') {
        return Promise.resolve({ data: 'session-abc', error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })
    // reservation user_id 조회 (fail-soft 채팅카드용)
    mockMaybeSingle.mockResolvedValue({ data: { user_id: 'user-1' }, error: null })

    const { sendPushToAdmins } = await import('$lib/server/push')

    const { cancelReservationWithRefund } = await vi.importActual<typeof import('$lib/server/cancelReservationWithRefund')>('$lib/server/cancelReservationWithRefund')
    const result = await cancelReservationWithRefund({
      reservationId: 42,
      callerId: 'user-1',
      cancelReason: '고객 자가취소',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('RPC_FAILED')
    // fail-soft: 관리자 알림 호출돼야 함
    expect(sendPushToAdmins).toHaveBeenCalled()
    // 관리자 채팅카드 삽입도 fail-soft
    expect(mockInsert).toHaveBeenCalled()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// C. POST /api/checkout/cancel-reservation — 엔드포인트
// ────────────────────────────────────────────────────────────────────────────

vi.mock('$lib/server/cancelReservationWithRefund', () => ({
  cancelReservationWithRefund: vi.fn(),
}))

vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    async json() { return data },
  }),
}))

describe('C. POST /api/checkout/cancel-reservation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const makeLocals = (userId = 'user-1') => ({
    safeGetSession: vi.fn().mockResolvedValue({ session: { user: { id: userId } } }),
  })
  const makeRequest = (body: Record<string, unknown>) => ({
    json: () => Promise.resolve(body),
  })

  it('SC-8 세션 없음 → 401', async () => {
    const { POST } = await import('../../routes/api/checkout/cancel-reservation/+server')
    const res = await POST({
      locals: { safeGetSession: vi.fn().mockResolvedValue({ session: null }) },
      request: makeRequest({ reservationId: 1 }),
    } as never) as { status: number }
    expect(res.status).toBe(401)
  })

  it('SC-7 타인 소유 예약 → 403 IDOR', async () => {
    const { POST } = await import('../../routes/api/checkout/cancel-reservation/+server')
    // 조회 결과: 다른 user_id
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: 99, status: 'hold', user_id: 'other-user', tracking_number: null, pickup_method: 'visit', start_date: '2099-12-31', pickup_time: '10:00' },
      error: null,
    })
    const res = await POST({
      locals: makeLocals('user-1'),
      request: makeRequest({ reservationId: 99 }),
    } as never) as { status: number }
    expect(res.status).toBe(403)
  })

  it('SC-3 confirmed + 운송장 있음 → 403 취소불가', async () => {
    const { POST } = await import('../../routes/api/checkout/cancel-reservation/+server')
    // 예약 조회: confirmed + tracking_number 있음
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: 42, status: 'confirmed', user_id: 'user-1', tracking_number: 'TRACK123', pickup_method: 'courier', start_date: '2099-12-31', pickup_time: null },
      error: null,
    })
    // order_items 조회: 없음
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
    // rental_method_options 조회
    mockMaybeSingle.mockResolvedValueOnce({ data: { is_delivery_type: true }, error: null })

    const res = await POST({
      locals: makeLocals('user-1'),
      request: makeRequest({ reservationId: 42 }),
    } as never) as { status: number }
    expect(res.status).toBe(403)
  })

  it('SC-1 hold 예약 취소 → update_reservation_status(cancelled), cancelReservationWithRefund 미호출', async () => {
    const { POST } = await import('../../routes/api/checkout/cancel-reservation/+server')
    const { cancelReservationWithRefund } = await import('$lib/server/cancelReservationWithRefund')

    // 예약 조회: hold + 배송
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: 42, status: 'hold', user_id: 'user-1', tracking_number: null, pickup_method: 'courier', start_date: '2099-12-31', pickup_time: null },
      error: null,
    })
    // order_items 조회: 없음
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
    // rental_method_options 조회: is_delivery_type=true
    mockMaybeSingle.mockResolvedValueOnce({ data: { is_delivery_type: true }, error: null })
    // update_reservation_status RPC 성공
    mockAdminRpc.mockImplementation((fn: string) => {
      if (fn === 'update_reservation_status') return Promise.resolve({ data: { ok: true }, error: null })
      return Promise.resolve({ data: null, error: null })
    })

    const res = await POST({
      locals: makeLocals('user-1'),
      request: makeRequest({ reservationId: 42 }),
    } as never) as { status: number; json: () => Promise<{ ok: boolean }> }

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    // hold → Toss 환불 헬퍼 미호출
    expect(cancelReservationWithRefund).not.toHaveBeenCalled()
    // update_reservation_status 호출됨
    expect(mockAdminRpc).toHaveBeenCalledWith('update_reservation_status', expect.objectContaining({
      p_new_status: 'cancelled',
    }))
  })

  it('SC-2 confirmed + 배송 + 운송장 미등록 → cancelReservationWithRefund 호출', async () => {
    const { POST } = await import('../../routes/api/checkout/cancel-reservation/+server')
    const { cancelReservationWithRefund } = await import('$lib/server/cancelReservationWithRefund')
    vi.mocked(cancelReservationWithRefund).mockResolvedValue({ ok: true })

    // 예약 조회: confirmed + 배송 + 운송장 없음
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: 42, status: 'confirmed', user_id: 'user-1', tracking_number: null, pickup_method: 'courier', start_date: '2099-12-31', pickup_time: null },
      error: null,
    })
    // order_items: 없음
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
    // rental_method_options: is_delivery_type=true
    mockMaybeSingle.mockResolvedValueOnce({ data: { is_delivery_type: true }, error: null })

    const res = await POST({
      locals: makeLocals('user-1'),
      request: makeRequest({ reservationId: 42 }),
    } as never) as { status: number; json: () => Promise<{ ok: boolean }> }

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(cancelReservationWithRefund).toHaveBeenCalledWith(expect.objectContaining({
      reservationId: 42,
      cancelReason: '고객 자가취소(예약신청취소)',
    }))
  })

  it('SC-4 비배송 + 방문 5시간 이내 → 403 취소불가', async () => {
    const { POST } = await import('../../routes/api/checkout/cancel-reservation/+server')

    // 방문 5시간 이내 상황: start_date=오늘, pickup_time=5시간 후
    const now = new Date()
    const startDate = now.toISOString().slice(0, 10)
    const pickupHour = now.getHours() + 5
    const pickupTime = `${String(pickupHour).padStart(2, '0')}:00`

    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: 77, status: 'confirmed', user_id: 'user-1', tracking_number: null, pickup_method: 'visit', start_date: startDate, pickup_time: pickupTime },
      error: null,
    })
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
    // is_delivery_type=false (방문)
    mockMaybeSingle.mockResolvedValueOnce({ data: { is_delivery_type: false }, error: null })

    const res = await POST({
      locals: makeLocals('user-1'),
      request: makeRequest({ reservationId: 77 }),
    } as never) as { status: number }
    expect(res.status).toBe(403)
  })
})
