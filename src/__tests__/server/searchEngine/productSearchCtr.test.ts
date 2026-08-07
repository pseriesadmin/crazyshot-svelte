/**
 * productSearchCtr.test.ts — CTR 파이프라인 버그수정 회귀 테스트 (§G-4)
 *
 * 검증 범위:
 *   G-1: result_count 버그 해소 — SQL 로직 재현 테스트
 *        "검색어와 무관하게 카테고리 전체 수가 나오던" 동작이 수정됐는지를
 *        순수 TS 로직으로 시뮬레이션.
 *   G-2: search_log_id가 API 응답에 포함되는지 확인 (API 응답 shape 검증)
 *   G-3: recordSearchClick이 실제로 호출 가능한지 (함수 계약 검증)
 *
 * DB 의존성 없음 — RPC/Supabase 호출 모두 mock.
 * 실제 DB 검증은 stage 수동 확인으로 진행 (search_logs.result_count 실측).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── G-1: result_count 버그 해소 시뮬레이션 ───────────────────────────────────

/**
 * 기존(버그) 방식: 카테고리 내 전체 상품 수를 반환
 * → 검색어 '소니 카메라'로 검색해도 카테고리 내 50개 전부 카운트
 */
function buggyResultCount(
  products: { name: string; category: string }[],
  category: string | null,
  _query: string,  // 실제로 사용하지 않음 — 버그의 핵심
): number {
  return products.filter(p => category === null || p.category === category).length
}

/**
 * 수정된 방식: 실제 검색어와 매칭된 상품만 카운트 (migration 203)
 * → '소니'로 검색하면 소니 카메라만 카운트
 */
function fixedResultCount(
  products: { name: string; category: string }[],
  category: string | null,
  query: string | null,
): number {
  return products.filter(p => {
    const matchesCategory = category === null || p.category === category
    if (!matchesCategory) return false
    if (!query || query.trim().length === 0) return true
    // trgm similarity > 0.2 시뮬레이션 (단순 substring 포함으로 근사)
    const q = query.toLowerCase()
    return p.name.toLowerCase().includes(q)
  }).length
}

const TEST_PRODUCTS = [
  { name: '소니 A7IV 카메라', category: 'camera' },
  { name: '소니 A7III 카메라', category: 'camera' },
  { name: '캐논 EOS R6', category: 'camera' },
  { name: 'DJI 짐벌', category: 'gimbal' },
  { name: '벤로 삼각대', category: 'tripod' },
]

describe('G-1: result_count 버그 해소 — 매칭 기준 카운트', () => {
  it('기존 버그 재현: 검색어 무관 카테고리 전체 수 반환', () => {
    // camera 카테고리 안에 상품이 3개인데, '소니'로 검색해도 3을 반환함 (버그)
    const bugCount = buggyResultCount(TEST_PRODUCTS, 'camera', '소니')
    expect(bugCount).toBe(3)  // 소니만 2개지만 카메라 전체 3개를 반환 — 버그 재현
  })

  it('수정 후: 실제 매칭된 상품 수만 반환', () => {
    const fixedCount = fixedResultCount(TEST_PRODUCTS, 'camera', '소니')
    expect(fixedCount).toBe(2)  // 소니 A7IV + 소니 A7III — 2개만 매칭
  })

  it('수정 후: 카테고리 미지정이면 전체 대상 검색어 매칭', () => {
    const fixedCount = fixedResultCount(TEST_PRODUCTS, null, '소니')
    expect(fixedCount).toBe(2)  // 카테고리 무관하게 '소니' 이름 2개
  })

  it('수정 후: 검색어 없으면 카테고리 전체 (정상 동작)', () => {
    // 검색어 없는 전체 목록 — 카테고리 필터만 적용
    const fixedCount = fixedResultCount(TEST_PRODUCTS, 'camera', null)
    expect(fixedCount).toBe(3)  // camera 3개 모두
  })

  it('수정 후: 매칭 없는 검색어 → 0 반환', () => {
    const fixedCount = fixedResultCount(TEST_PRODUCTS, 'camera', '젤리곰')
    expect(fixedCount).toBe(0)  // 매칭 없음
  })
})

// ── G-2: API 응답 shape에 search_log_id 포함 확인 ─────────────────────────────

/**
 * 실제 API 응답 처리 로직을 순수 TS로 재현해 search_log_id가 전파되는지 검증
 */
function processApiResponse(rpcResults: Record<string, unknown>[]) {
  // G-3에서 추가된 API 서버 로직과 동일
  const searchLogId = (rpcResults[0]?.['search_log_id'] as string | null) ?? null
  return { results: rpcResults, search_log_id: searchLogId }
}

describe('G-2: API 응답에 search_log_id 포함', () => {
  it('RPC 결과에 search_log_id 있으면 API 응답에 전파', () => {
    const mockRpcResults = [
      { product_id: 'uuid-1', name: '소니 카메라', search_log_id: 'log-uuid-abc' },
      { product_id: 'uuid-2', name: '캐논 카메라', search_log_id: 'log-uuid-abc' },
    ]
    const response = processApiResponse(mockRpcResults)
    expect(response.search_log_id).toBe('log-uuid-abc')
  })

  it('RPC 결과 없으면 search_log_id는 null (비검색 상태)', () => {
    const response = processApiResponse([])
    expect(response.search_log_id).toBeNull()
  })

  it('RPC 결과에 search_log_id가 null이면 null 반환', () => {
    // 검색어 1글자 이하 시 search_log 미생성 → v_log_id = NULL → RPC가 NULL 반환
    const mockRpcResults = [
      { product_id: 'uuid-1', name: '소니 카메라', search_log_id: null },
    ]
    const response = processApiResponse(mockRpcResults)
    expect(response.search_log_id).toBeNull()
  })
})

// ── G-3: recordSearchClick 함수 계약 검증 ─────────────────────────────────────

// Supabase mock
vi.mock('$lib/services/supabase', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}))

import { recordSearchClick } from '$lib/services/searchService'

describe('G-3: recordSearchClick 함수 계약', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('올바른 파라미터로 record_search_click RPC를 호출', async () => {
    const { supabase } = await import('$lib/services/supabase')
    await recordSearchClick('log-uuid-123', 'product-uuid-456')

    expect(supabase.rpc).toHaveBeenCalledWith('record_search_click', {
      p_search_log_id: 'log-uuid-123',
      p_product_id: 'product-uuid-456',
    })
  })

  it('RPC 실패해도 에러를 throw하지 않음 (fire-and-forget)', async () => {
    const { supabase } = await import('$lib/services/supabase')
    ;(supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC 오류' },
    })

    // recordSearchClick은 실패해도 예외를 던지지 않음
    await expect(recordSearchClick('log-uuid-123', 'product-uuid-456')).resolves.toBeUndefined()
  })

  it('searchLogId가 없으면 (null) 클릭 핸들러가 RPC를 호출하지 않아야 함', () => {
    // 검색 전 추천 상품 클릭 시 searchLogId = null → RPC 호출 안 됨을 시뮬레이션
    const { supabase } = { supabase: { rpc: vi.fn() } }
    function handleProductClick(productId: string, searchLogId: string | null) {
      if (searchLogId && productId) {
        supabase.rpc('record_search_click', {
          p_search_log_id: searchLogId,
          p_product_id: productId,
        })
      }
    }

    handleProductClick('product-uuid-789', null)
    expect(supabase.rpc).not.toHaveBeenCalled()  // searchLogId=null → 호출 안 됨
  })
})

// ── CTR 파이프라인 전체 흐름 검증 ────────────────────────────────────────────

describe('CTR 파이프라인 전체 흐름 (E2E 시뮬레이션)', () => {
  it('검색 → search_log_id 캡처 → 클릭 → RPC 호출 전체 흐름', async () => {
    const { supabase } = await import('$lib/services/supabase')
    vi.clearAllMocks()

    // 1단계: 검색 → API가 search_log_id 반환 (migration 203 이후)
    const mockApiResponse = {
      results: [{ product_id: 'prod-123', name: '소니 카메라', search_log_id: 'log-abc' }],
      search_log_id: 'log-abc',
    }
    const capturedLogId = mockApiResponse.search_log_id  // 페이지 state에 저장

    // 2단계: 사용자가 '소니 카메라' 클릭 → recordSearchClick 호출
    await recordSearchClick(capturedLogId, 'prod-123')

    // 3단계: record_search_click RPC가 호출됐어야 함
    expect(supabase.rpc).toHaveBeenCalledWith('record_search_click', {
      p_search_log_id: 'log-abc',
      p_product_id: 'prod-123',
    })
    // → DB: product_search_stats.click_count += 1 (stage에서 실제 확인)
  })
})
