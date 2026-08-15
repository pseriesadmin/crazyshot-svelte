-- Migration 253: NLSearch 행동기반 학습 — 재검색 패턴 추출 RPC (§G-1)
-- find_search_reformulation_pairs: search_logs를 세션 단위 LATERAL 자체 조인해
-- "원 검색 0건 → 짧은 시간 안에 재검색 성공" 쌍을 추출한다.
-- 새 테이블·새 컬럼 없음 (순수 SELECT on search_logs).
-- 개인정보 주의: 이 RPC는 session_key(세션 식별자)를 반환하지만,
--   TypeScript 레이어(searchReformulationScan.ts)에서 session_key는 읽지 않고 버린다 —
--   synonym_group_members에는 검색어 텍스트(term)만 저장된다.
-- 2026-08-15

-- 오탐 방지 장치 7종 (§G 정의 그대로):
--   1. 시간창: 재검색이 원 검색으로부터 p_window_seconds 이내
--   2. 원 검색 result_count = 0
--   3. 재검색 result_count > 0
--   4. 직후 1건 한정 (LATERAL ORDER BY created_at LIMIT 1)
--   5. 어휘 sanity: 두 검색어 2~30자, 대소문자 무관 비교 시 서로 달라야 함
--   6. lookback 기간: 최근 p_lookback_days 일치만 대상
--   7. 세션 키 존재: COALESCE(session_id, user_id::text) IS NOT NULL

CREATE OR REPLACE FUNCTION public.find_search_reformulation_pairs(
  p_lookback_days   int DEFAULT 30,
  p_window_seconds  int DEFAULT 120
)
RETURNS TABLE(
  original_query    text,
  reformulated_query text,
  session_key       text,
  observed_at       timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  WITH zero_results AS (
    -- 장치 2: result_count = 0 인 검색 이벤트 (원 검색 실패)
    -- 장치 6: lookback 기간 제한
    -- 장치 5(부분): 원 검색어 2~30자
    -- 장치 7: 세션 키 존재
    SELECT
      id,
      COALESCE(session_id, user_id::text) AS session_key,
      query                               AS original_query,
      created_at
    FROM public.search_logs
    WHERE
      result_count  = 0
      AND created_at >= (now() - (p_lookback_days || ' days')::interval)
      AND char_length(query) BETWEEN 2 AND 30
      AND COALESCE(session_id, user_id::text) IS NOT NULL
  )
  SELECT
    zr.original_query,
    sl_next.query         AS reformulated_query,
    zr.session_key,
    sl_next.created_at    AS observed_at
  FROM zero_results zr
  -- 장치 4: 직후 1건 한정 — LATERAL + ORDER BY created_at ASC + LIMIT 1
  JOIN LATERAL (
    SELECT sl.query, sl.created_at
    FROM public.search_logs sl
    WHERE
      -- 동일 세션
      COALESCE(sl.session_id, sl.user_id::text) = zr.session_key
      -- 장치 1: 시간창 — 원 검색 이후 p_window_seconds 이내
      AND sl.created_at > zr.created_at
      AND sl.created_at <= zr.created_at + (p_window_seconds || ' seconds')::interval
      -- 장치 3: 재검색 성공 (result_count > 0)
      AND sl.result_count > 0
      -- 장치 5: 재검색어 2~30자
      AND char_length(sl.query) BETWEEN 2 AND 30
      -- 장치 5: 대소문자 무관 비교 시 원 검색어와 달라야 함
      AND lower(sl.query) <> lower(zr.original_query)
    ORDER BY sl.created_at ASC
    LIMIT 1   -- 장치 4: 직후 1건만
  ) sl_next ON true
$$;

-- 권한: service_role 전용 (search_logs RLS bypass + 관리자 스캔 전용)
REVOKE ALL   ON FUNCTION public.find_search_reformulation_pairs(int, int)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.find_search_reformulation_pairs(int, int)
  TO service_role;

-- ============================================================
-- ROLLBACK (역순 실행)
-- ============================================================
-- DROP FUNCTION IF EXISTS public.find_search_reformulation_pairs(int, int);
-- ============================================================
