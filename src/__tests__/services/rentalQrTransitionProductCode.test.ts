import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Bug 1 회귀 테스트 — QR 스캔 상품이력 자동기록 시 product_code→UUID 변환
 * Harness Flow v3.2 | GSD 수정 검증
 *
 * 대상: src/lib/server/rentalQrTransition.ts (processRentalQrTransition)
 *
 * 수정 내용:
 *   - productId가 UUID가 아닌 product_code 문자열인 경우 products 테이블에서 실제 UUID 조회
 *   - ilike + escapeLikePattern 조합(QR-CASE-1: 소문자 혼입 product_code 대응)
 *   - histErr 체크 후 console.warn (fail-soft)
 *
 * 케이스:
 *   QT-1: UUID 형식 productId → DB 조회 없이 그대로 RPC에 전달
 *   QT-2: product_code 형식 → DB 조회 → 매칭 UUID 발견 → 그 UUID로 RPC 호출
 *   QT-3: product_code 형식 → DB 조회 → 매칭 없음(null) → RPC 미호출 (기록 건너뜀)
 *   QT-4: upsert_product_history_record 실패 시 console.warn, ok:true 유지 (fail-soft)
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

vi.mock('$lib/server/awardRentalCompletePoints', () => ({
  awardRentalCompletePoints: vi.fn().mockResolvedValue(undefined),
}))

const { processRentalQrTransition } = await import('$lib/server/rentalQrTransition')

// ── 헬퍼: from().select().ilike().is().maybeSingle() 체인 모킹 ───────────────
function makeQueryChain(resolvedRow: { id: string } | null) {
  return {
    select: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: resolvedRow }),
  }
}

// ── 헬퍼: admin 클라이언트 팩토리 ────────────────────────────────────────────
const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'
const RESOLVED_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

function makeAdmin(options: {
  productRow?: { id: string } | null
  histError?: { message: string } | null
} = {}) {
  const { productRow = null, histError = null } = options
  const fromChain = makeQueryChain(productRow ?? null)

  return {
    rpc: vi.fn().mockImplementation((name: string) => {
      if (name === 'upsert_product_history_record') {
        return Promise.resolve({ data: null, error: histError ?? null })
      }
      // update_reservation_status, send_rental_chat_notification, log_rental_action
      return Promise.resolve({ data: { ok: true }, error: null })
    }),
    from: vi.fn().mockReturnValue(fromChain),
    _fromChain: fromChain,
  }
}

// ── 테스트 ───────────────────────────────────────────────────────────────────
describe('QR 스캔 상품이력 기록 — product_code→UUID 변환 검증 (Bug 1 회귀)', () => {
  const RESERVATION_ID = 9001
  const USER_ID = 'admin-uuid-0001'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  it('QT-1: UUID 형식 productId → admin.from() 미호출, RPC에 UUID 그대로 전달', async () => {
    const admin = makeAdmin()

    const result = await processRentalQrTransition(admin as never, {
      reservationId: RESERVATION_ID,
      newStatus: 'shipped',
      productId: VALID_UUID,
      userId: USER_ID,
    })

    expect(result.ok).toBe(true)
    // UUID이면 DB 조회 분기를 건너뜀
    expect(admin.from).not.toHaveBeenCalled()
    // RPC 중 upsert_product_history_record 호출 확인
    const histCall = (admin.rpc as ReturnType<typeof vi.fn>).mock.calls.find(
      ([name]) => name === 'upsert_product_history_record',
    )
    expect(histCall).toBeTruthy()
    expect(histCall![1]).toMatchObject({ p_product_id: VALID_UUID })
  })

  it('QT-2: product_code 형식 → DB 조회 → UUID 발견 → 그 UUID로 이력 RPC 호출', async () => {
    const PRODUCT_CODE = 'CSCRDSL0010000'
    const admin = makeAdmin({ productRow: { id: RESOLVED_UUID } })

    const result = await processRentalQrTransition(admin as never, {
      reservationId: RESERVATION_ID,
      newStatus: 'shipped',
      productId: PRODUCT_CODE,
      userId: USER_ID,
    })

    expect(result.ok).toBe(true)
    // from('products') 호출됨
    expect(admin.from).toHaveBeenCalledWith('products')
    // ilike로 product_code 조회 (대소문자 무관 — QR-CASE-1)
    expect(admin._fromChain.ilike).toHaveBeenCalledWith('product_code', PRODUCT_CODE)
    // upsert_product_history_record에 resolvedUUID 전달
    const histCall = (admin.rpc as ReturnType<typeof vi.fn>).mock.calls.find(
      ([name]) => name === 'upsert_product_history_record',
    )
    expect(histCall).toBeTruthy()
    expect(histCall![1]).toMatchObject({ p_product_id: RESOLVED_UUID })
  })

  it('QT-3: product_code → DB 조회 → 매칭 없음 → 이력 RPC 미호출', async () => {
    const PRODUCT_CODE = 'CSPARall00001'
    const admin = makeAdmin({ productRow: null })

    const result = await processRentalQrTransition(admin as never, {
      reservationId: RESERVATION_ID,
      newStatus: 'shipped',
      productId: PRODUCT_CODE,
      userId: USER_ID,
    })

    expect(result.ok).toBe(true)
    // DB 조회는 시도됐어야 함
    expect(admin.from).toHaveBeenCalledWith('products')
    // 매칭 없어서 RPC 미호출
    const histCall = (admin.rpc as ReturnType<typeof vi.fn>).mock.calls.find(
      ([name]) => name === 'upsert_product_history_record',
    )
    expect(histCall).toBeUndefined()
  })

  it('QT-4: upsert_product_history_record 실패 → console.warn, 메인 흐름 ok:true 유지 (fail-soft)', async () => {
    const admin = makeAdmin({
      productRow: null, // UUID이므로 DB 조회 없음 — histError만 테스트
      histError: { message: 'DB 이력 기록 실패' },
    })
    // UUID로 직접 전달하면 DB 조회 없이 바로 RPC를 시도하는 경로를 테스트
    // (DB 조회 없이 histErr 경로만 검증)
    const admin2 = makeAdmin({ histError: { message: 'DB 이력 기록 실패' } })

    const result = await processRentalQrTransition(admin2 as never, {
      reservationId: RESERVATION_ID,
      newStatus: 'shipped',
      productId: VALID_UUID,
      userId: USER_ID,
    })

    expect(result.ok).toBe(true)
    // console.warn('[rentalQrTransition] 상품이력 기록 실패:', msg, '| productId:', uuid) — 4인자
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[rentalQrTransition]'),
      expect.any(String),
      expect.any(String),
      expect.stringContaining(VALID_UUID),
    )
  })
})
