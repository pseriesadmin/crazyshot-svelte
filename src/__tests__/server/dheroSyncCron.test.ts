import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TDD — cron dhero-sync + maybeAutoAdvanceOnDheroDelivered 연동 검증
 *
 * cron 연동 케이스:
 *   C-1. tracking_number 있는 예약 동기화 후 direction='pickup'으로 자동전이 함수 호출
 *   C-2. dhero_return_book_id 있는 예약도 조회해서 direction='return'으로 자동전이 함수 호출
 *   C-3. EC-3: dhero_return_book_id 조회 결과가 배송완료(5)인데 예약 status가 'in_use' → 스킵
 *
 * 주의: dheroAutoAdvance 모듈을 vi.mock으로 대체 → 이 파일에서만 영향
 *       단위 테스트(dheroAutoAdvance.test.ts)와 분리된 별도 파일
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

// maybeAutoAdvanceOnDheroDelivered 모킹 — cron이 이 함수를 올바른 인자로 호출하는지만 검증
const mockMaybeAutoAdvance = vi.fn()
vi.mock('$lib/server/dheroAutoAdvance', () => ({
  maybeAutoAdvanceOnDheroDelivered: (...args: unknown[]) => mockMaybeAutoAdvance(...args),
}))

// dhero API 모킹
const mockGetDeliveryByBookId = vi.fn()
vi.mock('$lib/server/dhero', () => ({
  getDeliveryByBookId: (...args: unknown[]) => mockGetDeliveryByBookId(...args),
  isDheroTerminalStatus: (code: number | null | undefined) => code != null && [5, 6, 7].includes(code),
  DHERO_STATUS_LABEL: { 0: '배송접수', 5: '배송완료', 6: '반송완료', 7: '분실완료' },
}))

// supabase env
vi.mock('$lib/env/supabasePublic', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
}))

// ── Supabase admin mock ────────────────────────────────────────────────────
const mockAdminRpc = vi.fn()
const mockAdminFrom = vi.fn()
const mockAdminForCron = {
  rpc: (...args: unknown[]) => mockAdminRpc(...args),
  from: (...args: unknown[]) => mockAdminFrom(...args),
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => mockAdminForCron,
}))

// ── DB 쿼리 체인 mock 헬퍼 ───────────────────────────────────────────────────
// .from().select().not(...).not(...) 또는 .not(...).is(...).not(...)
// 마지막 메서드가 await 되면 { data: rows, error: null } 반환

function makeChain(rows: Record<string, unknown>[]) {
  const result = { data: rows, error: null }
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn().mockReturnValue(chain)
  chain.not = vi.fn().mockReturnValue(chain)
  chain.is = vi.fn().mockReturnValue(chain)   // ← 필수 (returnOnlyRows 쿼리에 .is() 사용)
  // Promise 프로토콜 — await chain 하면 result 반환
  chain.then = (resolve: (v: unknown) => unknown) => resolve(result)
  return chain
}

// 두 번 호출되는 admin.from() — 1st: tracking_number 기준, 2nd: return_only
function setupFromMocks(
  pickupRows: Record<string, unknown>[],
  returnOnlyRows: Record<string, unknown>[] = [],
) {
  let callCount = 0
  mockAdminFrom.mockImplementation(() => {
    callCount++
    // 첫 번째 호출 = tracking_number 쿼리, 두 번째 = return_only 쿼리
    return callCount === 1 ? makeChain(pickupRows) : makeChain(returnOnlyRows)
  })
}

// ── 테스트 ──────────────────────────────────────────────────────────────────

describe('cron dhero-sync — 자동전이 연동', () => {
  beforeEach(() => {
    mockAdminRpc.mockReset()
    mockAdminFrom.mockReset()
    mockGetDeliveryByBookId.mockReset()
    mockMaybeAutoAdvance.mockReset()
    mockMaybeAutoAdvance.mockResolvedValue(undefined)
  })

  it('C-1 — tracking_number 있는 예약: 동기화 후 direction=pickup으로 자동전이 함수 호출', async () => {
    const reservation = {
      id: 101,
      tracking_number: 'BOOK-101',
      dhero_return_book_id: null,
      dhero_status_code: null,
      dhero_dong_group: null,
      status: 'shipped',
      pickup_method: 'crazydelivery',
      return_method: 'crazydelivery',
    }
    setupFromMocks([reservation])  // return_only 쿼리는 빈 배열

    mockGetDeliveryByBookId.mockResolvedValue({ status: 5, bookId: 'BOOK-101' })
    mockAdminRpc.mockResolvedValue({ data: null, error: null })

    const request = new Request('https://test.com/api/cron/dhero-sync', {
      headers: { authorization: 'Bearer test-cron-secret' },
    })

    const { GET } = await import('../../routes/api/cron/dhero-sync/+server')
    const resp = await GET({ request } as Parameters<typeof GET>[0])
    const body = await resp.json()

    expect(body.ok).toBe(true)
    // pickup 방향으로 자동전이 함수가 호출됨
    expect(mockMaybeAutoAdvance).toHaveBeenCalledWith(
      expect.anything(),
      101,
      'pickup',
      5,
      'crazydelivery',
      'crazydelivery',
      'shipped',
    )
  })

  it('C-2 — dhero_return_book_id 있는 예약: 반납 leg도 조회해서 direction=return으로 자동전이 호출', async () => {
    const reservation = {
      id: 102,
      tracking_number: 'BOOK-102',
      dhero_return_book_id: 'RETURN-BOOK-102',
      dhero_status_code: 5,  // 발송 leg는 종료상태 → isDheroTerminalStatus=true → 픽업 처리 스킵
      dhero_dong_group: null,
      status: 'return_requested',
      pickup_method: 'crazydelivery',
      return_method: 'crazydelivery',
    }
    // 두 쿼리 모두 같은 row 반환 — dhero_status_code=5라 픽업은 pickupTargets 필터에서 제외,
    // dhero_return_book_id 있는 행은 allRows에 포함되어 반납 leg 처리됨
    setupFromMocks([reservation], [])

    mockGetDeliveryByBookId.mockImplementation((bookId: string) => {
      if (bookId === 'BOOK-102') return Promise.resolve({ status: 5, bookId: 'BOOK-102' })
      if (bookId === 'RETURN-BOOK-102') return Promise.resolve({ status: 5, bookId: 'RETURN-BOOK-102' })
      return Promise.reject(new Error(`unknown bookId: ${bookId}`))
    })
    mockAdminRpc.mockResolvedValue({ data: null, error: null })

    const request = new Request('https://test.com/api/cron/dhero-sync', {
      headers: { authorization: 'Bearer test-cron-secret' },
    })

    const { GET } = await import('../../routes/api/cron/dhero-sync/+server')
    const resp = await GET({ request } as Parameters<typeof GET>[0])
    await resp.json()

    // direction=return으로 자동전이 함수가 호출됨
    expect(mockMaybeAutoAdvance).toHaveBeenCalledWith(
      expect.anything(),
      102,
      'return',
      5,
      'crazydelivery',
      'crazydelivery',
      'return_requested',
    )
  })

  it('C-3 — EC-3: return_book_id 배송완료인데 예약 status가 in_use → maybeAutoAdvance 호출되지만 내부에서 스킵', async () => {
    const reservation = {
      id: 103,
      tracking_number: null,
      dhero_return_book_id: 'RETURN-103',
      dhero_status_code: null,
      dhero_dong_group: null,
      status: 'in_use',
      pickup_method: 'crazydelivery',
      return_method: 'crazydelivery',
    }
    // 첫 번째 쿼리(tracking_number 기준): 빈 배열 (tracking_number IS NOT NULL 조건으로 인해)
    // 두 번째 쿼리(return_only): 이 예약 반환
    setupFromMocks([], [reservation])

    mockGetDeliveryByBookId.mockResolvedValue({ status: 5, bookId: 'RETURN-103' })
    mockAdminRpc.mockResolvedValue({ data: null, error: null })

    const request = new Request('https://test.com/api/cron/dhero-sync', {
      headers: { authorization: 'Bearer test-cron-secret' },
    })

    const { GET } = await import('../../routes/api/cron/dhero-sync/+server')
    const resp = await GET({ request } as Parameters<typeof GET>[0])
    await resp.json()

    // maybeAutoAdvance는 호출되지만, 함수 내부에서 EC-3(currentStatus='in_use' !== 'return_requested') → 스킵
    expect(mockMaybeAutoAdvance).toHaveBeenCalledWith(
      expect.anything(),
      103,
      'return',
      5,
      'crazydelivery',
      'crazydelivery',
      'in_use',
    )
  })
})
