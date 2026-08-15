/**
 * searchReformulationScan.ts — 재검색 행동 패턴 → 동의어 후보 등록 어댑터 (§G-2)
 *
 * find_search_reformulation_pairs RPC(migration 253)가 추출한 "원 검색 0건 → 재검색 성공" 쌍을
 * synonym_group_members에 query_reformulation 출처로 등록합니다.
 *
 * weight=1: cross_lingual_pattern(weight=2)보다 신뢰도가 낮은 행동 신호이므로
 *   더 보수적인 승격 속도 적용 — promote_threshold(기본 3)회 관찰 후 자동 승격.
 *
 * ⚠️ 이 파일은 서버 전용 ($env/static/private 사용). 클라이언트 번들 포함 금지.
 * ⚠️ registerCrossLingualCandidates(§C)와 달리 scanReformulationCandidates는
 *    fire-and-forget이 아님 — 관리자 수동 트리거이므로 에러를 호출부로 전파해야 합니다.
 *    관리자가 실패를 인지해 재시도할 수 있어야 합니다.
 */

import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { SYNONYM_PROMOTE_THRESHOLD } from './synonymLearning'

// 스캔 파라미터 — TASK.md §G 오탐 방지 장치 6·1번과 일치
const REFORMULATION_LOOKBACK_DAYS = 30
const REFORMULATION_WINDOW_SECONDS = 120

/** find_search_reformulation_pairs RPC 반환 행 타입 */
interface ReformulationPair {
  original_query: string
  reformulated_query: string
  session_key: string
  observed_at: string
}

/** scanReformulationCandidates 반환 통계 */
export interface ReformulationScanResult {
  /** RPC가 반환한 총 페어 수 (중복 포함) */
  totalPairs: number
  /** synonym_group_members에 신규 또는 upsert된 쌍 수 */
  registeredPairs: number
  /** 에러로 건너뛴 쌍 수 */
  skippedPairs: number
}

/**
 * 최근 REFORMULATION_LOOKBACK_DAYS 일치 search_logs에서 재검색 페어를 추출하고
 * synonym_group_members에 query_reformulation 출처로 등록합니다.
 *
 * 처리 흐름:
 *   1. find_search_reformulation_pairs RPC 호출 (순수 SELECT, 7가지 오탐 방지 장치 내장)
 *   2. 각 (original_query, reformulated_query) 쌍에 대해:
 *      a. original_query를 canonical term으로 동의어 그룹 찾기/생성
 *      b. reformulated_query를 weight=1로 upsert (source='query_reformulation')
 *         → promote_threshold 도달 시 자동 confirmed 승격
 *
 * ⚠️ 동일 페어가 여러 세션에서 반복 관찰될 때마다 occurrence_count가 누적됩니다.
 *    이것이 행동 신호로서 신뢰도를 쌓는 방식입니다.
 *
 * 에러 전파: 개별 페어 처리 실패는 skippedPairs로 집계하되 스캔 자체는 계속합니다.
 *   RPC 자체 실패(DB 연결 오류 등)는 throw해 호출부(관리자 API)에서 500으로 응답합니다.
 *
 * @returns ReformulationScanResult 통계 객체
 */
export async function scanReformulationCandidates(): Promise<ReformulationScanResult> {
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 1. G-1 RPC: 재검색 페어 목록 추출 (오탐 방지 장치 7종 내장)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pairs, error: rpcError } = await (admin as any).rpc(
    'find_search_reformulation_pairs',
    {
      p_lookback_days: REFORMULATION_LOOKBACK_DAYS,
      p_window_seconds: REFORMULATION_WINDOW_SECONDS,
    },
  )

  if (rpcError) {
    // RPC 자체 실패 — 호출부(관리자 API)로 전파
    throw new Error(`find_search_reformulation_pairs 실패: ${rpcError.message}`)
  }

  const pairList: ReformulationPair[] = pairs ?? []
  const result: ReformulationScanResult = {
    totalPairs: pairList.length,
    registeredPairs: 0,
    skippedPairs: 0,
  }

  // 2. 각 페어를 synonym_group_members에 등록
  for (const pair of pairList) {
    try {
      const { original_query, reformulated_query } = pair

      // a. original_query를 canonical term으로 그룹 찾기/생성
      const { data: groupId, error: groupErr } = await admin.rpc('find_or_create_synonym_group', {
        p_canonical_term: original_query,
      })
      if (groupErr || !groupId) {
        result.skippedPairs++
        continue
      }

      // b. reformulated_query를 weight=1로 upsert (source='query_reformulation')
      //    weight=1: 관찰 1회당 occurrence_count +1 (cross_lingual_pattern의 weight=2보다 보수적)
      await admin.rpc('upsert_synonym_member', {
        p_group_id: groupId,
        p_term: reformulated_query,
        p_threshold: SYNONYM_PROMOTE_THRESHOLD,
        p_source: 'query_reformulation',
      })

      result.registeredPairs++
    } catch {
      // 개별 페어 처리 실패 — 건너뛰고 계속 (스캔 자체는 중단하지 않음)
      result.skippedPairs++
    }
  }

  return result
}
