import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * L-3 (2026-10-08) — 정기 점검 cron /api/cron/search-index-health
 *
 * 케이스:
 *   1. CRON_SECRET 미설정 → 401 (fail-closed)
 *   2. Bearer 불일치/없음 → 401
 *   3. 서비스 키 없음 → 500
 *   4. 정상: 인덱스 재빌드 → 스냅샷 1행 insert(숫자·status만), 응답에 숫자만
 *   5. 직전 대비 후기 반영 50% 이상 급감 → warnings에 review_rows_dropped
 *   6. 인덱스 빌드 실패(status error) → warnings에 index_build_failed, 200 JSON
 *   7. 스냅샷 insert 실패 → 던지지 않고 recorded:false JSON
 *   8. 응답에 후기 문구·상품명 키가 없음(개인정보·콘텐츠 비노출)
 */

const envState: { CRON_SECRET?: string; SUPABASE_SERVICE_ROLE_KEY?: string } = {}
vi.mock('$env/dynamic/private', () => ({
  get env() {
    return envState
  },
}))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'test-key' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://test.supabase.co' }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://test.supabase.co' }))

const mockInvalidate = vi.fn()
const mockGetIndex = vi.fn()
const mockGetStats = vi.fn()
vi.mock('$lib/server/searchEngine/adapters/productSearchIndex', () => ({
  invalidateProductSearchCache: () => mockInvalidate(),
  getProductSearchIndex: () => mockGetIndex(),
  getLastIndexBuildStats: () => mockGetStats(),
}))

let previousRow: Record<string, unknown> | null = null
let insertError: { message: string } | null = null
const insertSpy = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => ({
            maybeSingle: async () => ({ data: previousRow, error: null }),
          }),
        }),
      }),
      insert: async (row: unknown) => {
        insertSpy(row)
        return { error: insertError }
      },
    }),
  }),
}))

import { GET } from '../../routes/api/cron/search-index-health/+server'

function call(authorization?: string) {
  const headers = new Headers()
  if (authorization) headers.set('authorization', authorization)
  const request = new Request('https://example.com/api/cron/search-index-health', { headers })
  return GET({ request } as unknown as Parameters<typeof GET>[0])
}

const OK_STATS = {
  indexedProducts: 148, reviewedProducts: 10, reviewRows: 40, weakProducts: 5,
  buildMs: 800, status: 'ok' as const, builtAt: Date.now(),
}

beforeEach(() => {
  vi.clearAllMocks()
  envState.CRON_SECRET = 'secret'
  envState.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
  previousRow = null
  insertError = null
  mockGetIndex.mockResolvedValue({})
  mockGetStats.mockReturnValue(OK_STATS)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('search-index-health cron', () => {
  it('1. CRON_SECRET 미설정이면 401', async () => {
    envState.CRON_SECRET = undefined
    const res = await call('Bearer secret')
    expect(res.status).toBe(401)
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('2. Bearer 불일치/없음이면 401', async () => {
    expect((await call('Bearer wrong')).status).toBe(401)
    expect((await call()).status).toBe(401)
    expect(mockInvalidate).not.toHaveBeenCalled()
  })

  it('3. 서비스 키가 없으면 500', async () => {
    envState.SUPABASE_SERVICE_ROLE_KEY = undefined
    const res = await call('Bearer secret')
    expect(res.status).toBe(500)
  })

  it('4. 정상: 인덱스를 재빌드하고 스냅샷 1행(숫자·status만)을 기록한다', async () => {
    const res = await call('Bearer secret')
    expect(res.status).toBe(200)
    expect(mockInvalidate).toHaveBeenCalledTimes(1)
    expect(mockGetIndex).toHaveBeenCalledTimes(1)
    expect(insertSpy).toHaveBeenCalledTimes(1)
    expect(insertSpy.mock.calls[0][0]).toEqual({
      indexed_products: 148, reviewed_products: 10, review_rows: 40,
      weak_products: 5, build_ms: 800, status: 'ok',
    })
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.recorded).toBe(true)
    expect(body.warnings).toEqual([])
  })

  it('5. 직전 대비 후기 반영이 50% 미만으로 급감하면 경고한다', async () => {
    previousRow = { indexed_products: 148, reviewed_products: 10, review_rows: 100, weak_products: 5, build_ms: 800, status: 'ok' }
    mockGetStats.mockReturnValue({ ...OK_STATS, reviewRows: 40 })
    const body = await (await call('Bearer secret')).json()
    expect(body.warnings).toContain('review_rows_dropped')
  })

  it('5-b. 직전 후기 반영이 0이면 급감 비교를 하지 않는다', async () => {
    previousRow = { indexed_products: 148, reviewed_products: 0, review_rows: 0, weak_products: 5, build_ms: 800, status: 'ok' }
    mockGetStats.mockReturnValue({ ...OK_STATS, reviewRows: 0 })
    const body = await (await call('Bearer secret')).json()
    expect(body.warnings).toEqual([])
  })

  it('6. 인덱스 빌드 실패면 index_build_failed 경고와 함께 200 JSON', async () => {
    mockGetStats.mockReturnValue({ ...OK_STATS, indexedProducts: 0, status: 'error' as const })
    const res = await call('Bearer secret')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.warnings).toContain('index_build_failed')
    expect(body.ok).toBe(false)
  })

  it('6-b. 빌드 시간이 직전의 3배를 넘으면 build_time_spiked 경고', async () => {
    previousRow = { indexed_products: 148, reviewed_products: 0, review_rows: 0, weak_products: 5, build_ms: 200, status: 'ok' }
    mockGetStats.mockReturnValue({ ...OK_STATS, buildMs: 900 })
    const body = await (await call('Bearer secret')).json()
    expect(body.warnings).toContain('build_time_spiked')
  })

  it('7. 스냅샷 기록 실패여도 던지지 않고 recorded:false로 응답한다', async () => {
    insertError = { message: 'insert failed' }
    const res = await call('Bearer secret')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.recorded).toBe(false)
    expect(body.ok).toBe(false)
  })

  it('7-b. 인덱스 빌드가 예외를 던져도 던지지 않고 오류 JSON을 반환한다', async () => {
    mockGetIndex.mockRejectedValue(new Error('boom'))
    const res = await call('Bearer secret')
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(false)
  })

  it('8. 응답에는 숫자·상태만 있고 후기 문구·상품명·작성자 키가 없다', async () => {
    const body = await (await call('Bearer secret')).json()
    const keys = Object.keys(body).sort()
    expect(keys).toEqual(
      ['build_ms', 'indexed_products', 'ok', 'recorded', 'review_rows', 'reviewed_products', 'status', 'warnings', 'weak_products'].sort(),
    )
    const serialized = JSON.stringify(body)
    for (const forbidden of ['review_text', 'reviews_text', 'name', 'author', 'user_id']) {
      expect(serialized.includes(`"${forbidden}"`)).toBe(false)
    }
  })
})
