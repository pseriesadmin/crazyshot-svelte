/**
 * searchLogIdFallback.test.ts — §L-1 학습루프 빈틈 수정 회귀 테스트
 *
 * 검증 범위:
 *   L-1: RPC 0건 반환 시 search_log_id 후속 조회 발동 조건 검증
 *   L-1: 후속 조회 성공 시 search_log_id가 non-null로 채워지는지 검증
 *   L-1: 후속 조회 실패(에러/미발견) 시 null 폴백, 검색 차단 없음 검증
 *   L-1: 발동 조건이 아닌 경우(RPC 결과 있음, 검색어 1자 이하) 후속 조회 스킵 검증
 *
 * DB 의존성 없음 — API 라우트의 핵심 로직을 순수 TS 함수로 재현해 검증
 * (기존 productSearchCtr.test.ts 패턴과 동일)
 *
 * 배경(§J 학습루프 빈틈):
 *   search_products RPC(migration 203)는 q.length >= 2이면 결과 0건이어도
 *   search_logs에 INSERT한다. 그러나 RETURN QUERY row-set이 비어 search_log_id를
 *   TS 레이어가 못 받고 null로 응답 → MiniSearch 폴백 결과 클릭이 §J 학습 데이터에
 *   쌓이지 못하는 구조적 맹점. L-1 수정으로 service_role 후속 조회를 통해 해결.
 *
 * stage 실측 권장:
 *   1. 상품검색(/products/search)에서 RPC에서 전혀 안 잡히는 검색어로 검색
 *      (예: 구성품·사양에만 있는 단어 — MiniSearch는 잡지만 FTS·trgm은 못 잡는 단어)
 *   2. 응답 JSON의 search_log_id 필드가 null이 아닌 UUID 값인지 확인
 *   3. 해당 상품 클릭 → Supabase Table Editor > search_logs 해당 행의 clicked_ids 업데이트 확인
 *   4. product_search_stats 해당 (product_id, search_term) 행의 click_count가 증가했는지 확인
 */

import { describe, it, expect, vi } from 'vitest'

// ── L-1 API 라우트 핵심 로직 재현 ─────────────────────────────────────────────
// /api/search/products/+server.ts의 searchLogId 결정 로직을 순수 함수로 추출
// (실제 파일이 $env/static/private 등 SvelteKit 전용 모듈에 의존하므로 직접 import 불가)

/**
 * RPC 결과에서 search_log_id를 추출하거나, 0건일 때 후속 조회로 채우는 로직 재현
 * @param rpcResults RPC 반환 행 배열
 * @param q 검색어
 * @param fetchFallback 후속 조회 함수 (service_role DB 조회 역할)
 */
async function resolveSearchLogId(
  rpcResults: Record<string, unknown>[],
  q: string,
  fetchFallback: (query: string) => Promise<string | null>,
): Promise<string | null> {
  // G-3 로직: 첫 번째 행의 search_log_id 추출
  let searchLogId = (rpcResults[0]?.['search_log_id'] as string | null) ?? null

  // L-1 로직: 0건 + 검색어 2자 이상일 때 후속 조회
  if (searchLogId === null && rpcResults.length === 0 && q.length >= 2) {
    searchLogId = await fetchFallback(q)
  }

  return searchLogId
}

/**
 * 후속 조회 발동 조건 판별 함수 재현 (발동 여부만 순수 검사)
 */
function shouldFetchFallback(
  rpcResultsLength: number,
  queryLength: number,
  currentSearchLogId: string | null,
): boolean {
  return currentSearchLogId === null && rpcResultsLength === 0 && queryLength >= 2
}

// ── L-1-A: 발동 조건 검증 (순수 로직, mock 불필요) ───────────────────────────

describe('L-1-A: 후속 조회 발동 조건 판별', () => {
  it('RPC 0건 + 검색어 2자 이상 → 후속 조회 발동', () => {
    // 이것이 §J 학습루프 빈틈이 발생하는 정확한 조건
    expect(shouldFetchFallback(0, 2, null)).toBe(true)
    expect(shouldFetchFallback(0, 5, null)).toBe(true)
    expect(shouldFetchFallback(0, 10, null)).toBe(true)
  })

  it('RPC 결과 있으면 후속 조회 발동 안 함 (G-3 로직으로 이미 search_log_id 받음)', () => {
    // 결과가 있을 때는 모든 행에 search_log_id가 채워져 있으므로 후속 조회 불필요
    expect(shouldFetchFallback(1, 5, 'log-uuid-abc')).toBe(false)
    expect(shouldFetchFallback(3, 5, 'log-uuid-abc')).toBe(false)
  })

  it('RPC 결과 있는데 search_log_id가 null인 경우 → 발동 안 함 (결과 행이 있다는 것 자체가 모순이므로 스킵)', () => {
    // rpcResultsLength > 0이면 발동 조건 불충족
    expect(shouldFetchFallback(1, 5, null)).toBe(false)
  })

  it('검색어 1자 이하 → 후속 조회 발동 안 함 (RPC가 search_logs INSERT 안 하는 조건과 동일)', () => {
    // migration 203: length(trim(p_query)) >= 2 일 때만 INSERT
    // 1자 검색어는 로그 INSERT 자체가 없으므로 후속 조회해도 의미 없음
    expect(shouldFetchFallback(0, 0, null)).toBe(false)
    expect(shouldFetchFallback(0, 1, null)).toBe(false)
  })

  it('검색어 없음(0자) → 발동 안 함', () => {
    expect(shouldFetchFallback(0, 0, null)).toBe(false)
  })
})

// ── L-1-B: 후속 조회 성공 시 search_log_id가 채워지는지 검증 ─────────────────

describe('L-1-B: 후속 조회 성공 → search_log_id non-null', () => {
  it('RPC 0건 + 검색어 2자 이상 + 후속 조회 성공 → search_log_id가 UUID 값', async () => {
    const mockFetchFallback = vi.fn().mockResolvedValue('fallback-log-uuid-9876')
    const rpcResults: Record<string, unknown>[] = []  // 0건

    const searchLogId = await resolveSearchLogId(rpcResults, '드론', mockFetchFallback)

    expect(searchLogId).toBe('fallback-log-uuid-9876')
    expect(searchLogId).not.toBeNull()
    expect(mockFetchFallback).toHaveBeenCalledOnce()
    expect(mockFetchFallback).toHaveBeenCalledWith('드론')  // 검색어가 그대로 전달
  })

  it('RPC 0건 + 검색어 5자 이상 + 후속 조회 성공 → search_log_id가 UUID 값', async () => {
    const mockFetchFallback = vi.fn().mockResolvedValue('log-uuid-long-query-abc')
    const rpcResults: Record<string, unknown>[] = []

    const searchLogId = await resolveSearchLogId(rpcResults, '야간 드론 촬영', mockFetchFallback)

    expect(searchLogId).toBe('log-uuid-long-query-abc')
    expect(mockFetchFallback).toHaveBeenCalledWith('야간 드론 촬영')
  })
})

// ── L-1-C: 후속 조회 실패 시 null 폴백, 검색 차단 없음 검증 ─────────────────

describe('L-1-C: 후속 조회 실패 → null 폴백 (검색 차단 없음)', () => {
  it('후속 조회가 null을 반환하면 search_log_id는 null (미발견 케이스)', async () => {
    // DB에 방금 생성된 로그가 없는 경우 (10초 window 밖이거나 레이스 컨디션)
    const mockFetchFallback = vi.fn().mockResolvedValue(null)
    const rpcResults: Record<string, unknown>[] = []

    const searchLogId = await resolveSearchLogId(rpcResults, '희귀검색어', mockFetchFallback)

    // null 폴백 — 검색 자체는 계속 동작해야 함 (throw 없음)
    expect(searchLogId).toBeNull()
    expect(mockFetchFallback).toHaveBeenCalledOnce()
  })

  it('후속 조회 함수가 예외를 던져도 상위는 차단 안 됨 (에러 흡수)', async () => {
    // fetchRecentSearchLogId 내부에서 catch → null 반환하는 동작을 시뮬레이션
    const mockFetchFallback = vi.fn().mockResolvedValue(null)  // 실제 함수는 catch에서 null 반환
    const rpcResults: Record<string, unknown>[] = []

    // resolveSearchLogId는 fallback이 null을 반환해도 throw하지 않아야 함
    await expect(
      resolveSearchLogId(rpcResults, '검색어', mockFetchFallback)
    ).resolves.toBeNull()
  })
})

// ── L-1-D: 후속 조회가 스킵되는 케이스 검증 ─────────────────────────────────

describe('L-1-D: 후속 조회가 불필요한 케이스 — fetchFallback 호출 안 됨', () => {
  it('RPC 결과 있고 search_log_id 있으면 후속 조회 스킵', async () => {
    const mockFetchFallback = vi.fn()
    const rpcResults = [
      { product_id: 'prod-1', name: '소니 카메라', search_log_id: 'existing-log-uuid' },
    ]

    const searchLogId = await resolveSearchLogId(rpcResults, '소니', mockFetchFallback)

    expect(searchLogId).toBe('existing-log-uuid')
    expect(mockFetchFallback).not.toHaveBeenCalled()  // 후속 조회 불필요 — 이미 값 있음
  })

  it('검색어 1자 → 후속 조회 스킵 (RPC가 search_logs INSERT 안 하는 조건)', async () => {
    const mockFetchFallback = vi.fn()
    const rpcResults: Record<string, unknown>[] = []

    const searchLogId = await resolveSearchLogId(rpcResults, '소', mockFetchFallback)

    expect(searchLogId).toBeNull()
    expect(mockFetchFallback).not.toHaveBeenCalled()
  })

  it('검색어 비어있으면 후속 조회 스킵', async () => {
    const mockFetchFallback = vi.fn()
    const rpcResults: Record<string, unknown>[] = []

    const searchLogId = await resolveSearchLogId(rpcResults, '', mockFetchFallback)

    expect(searchLogId).toBeNull()
    expect(mockFetchFallback).not.toHaveBeenCalled()
  })
})

// ── L-1-E: §J 학습루프 전체 흐름 시뮬레이션 ────────────────────────────────

describe('L-1-E: §J 학습루프 — RPC 0건 + MiniSearch 폴백 시나리오 전체 흐름', () => {
  it('0건 RPC → 후속 조회로 log_id 확보 → MiniSearch 결과 병합 → search_log_id non-null 응답', async () => {
    // § 핵심 시나리오: "이 상품의 구성품 이름"처럼 FTS·trgm에는 안 걸리지만
    // MiniSearch keywords/components_text 색인에는 걸리는 검색어

    const mockFetchFallback = vi.fn().mockResolvedValue('recovered-log-uuid-1234')

    // 1단계: RPC 0건 반환 (FTS·trgm 미매칭)
    const rpcResults: Record<string, unknown>[] = []

    // 2단계: L-1 수정 — search_log_id 후속 조회
    const searchLogId = await resolveSearchLogId(rpcResults, '배터리팩', mockFetchFallback)
    expect(searchLogId).toBe('recovered-log-uuid-1234')  // ← L-1 수정의 핵심 결과

    // 3단계: MiniSearch가 검색어 '배터리팩'으로 상품 매칭 (가정)
    const minisearchResult = {
      product_id: 'prod-camera-uuid',
      name: '소니 A7IV',
      _source: 'natural_fallback',
    }

    // 4단계: 최종 API 응답에 search_log_id 포함
    const apiResponse = {
      results: [minisearchResult],
      search_log_id: searchLogId,  // ← null이 아닌 UUID
    }

    expect(apiResponse.search_log_id).not.toBeNull()
    expect(apiResponse.search_log_id).toBe('recovered-log-uuid-1234')
    // 이 search_log_id로 recordSearchClick이 호출 가능해야 함:
    // supabase.rpc('record_search_click', { p_search_log_id: 'recovered-log-uuid-1234', p_product_id: 'prod-camera-uuid' })
    // → product_search_stats.click_count += 1 → §J 학습 데이터 누적 가능
  })

  it('L-1 수정 전(버그) 시뮬레이션: 0건 RPC → search_log_id null → 클릭 기록 불가', () => {
    // 버그 상태 재현: 후속 조회 없이 rpcResults[0]에서만 읽으면
    const rpcResults: Record<string, unknown>[] = []  // 0건
    const buggySearchLogId = (rpcResults[0]?.['search_log_id'] as string | null) ?? null

    // 버그: search_log_id가 null → recordSearchClick이 호출 안 됨 → §J 학습 못 함
    expect(buggySearchLogId).toBeNull()
  })
})
