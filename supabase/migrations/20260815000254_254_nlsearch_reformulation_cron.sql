-- Migration 254: NLSearch 재검색 행동학습 자동 스케줄 (§G-6)
-- 목적: find_search_reformulation_pairs RPC(migration 253) 결과를
--   매일 새벽 3시 pg_cron으로 자동 실행해 synonym_group_members에 등록.
--
-- 설계 원칙:
--   1. canonical_term = lower(original_query)  — 검색 실패 측이 "사용자의 원래 의도"를 대표.
--      crossLingualSynonymScan.ts가 hangul을 canonical로 쓰는 관례와 동일 논리.
--   2. 30일 룩백 중복 방지: GROUP BY lower()로 중복 제거 후 고유 쌍당 1회만 upsert.
--      (매일 실행이므로 일 단위 누적 방식이 자연스럽고 오버-프로모션을 방지함)
--   3. 개인정보 원칙: session_key는 집계에 사용하지 않고 최종 저장도 하지 않음.
--      synonym_group_members에는 검색어 텍스트(term)만 저장.
-- 2026-08-15

-- ── 1. run_search_reformulation_scan() ────────────────────────────────────────
-- pg_cron이 직접 실행하는 순수 SQL 오케스트레이션 함수.
-- TypeScript searchReformulationScan.ts의 수동 트리거 경로와 독립적으로 공존.

CREATE OR REPLACE FUNCTION public.run_search_reformulation_scan()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_canonical text;
  v_member    text;
  v_group_id  uuid;
BEGIN
  -- find_search_reformulation_pairs: 최근 30일, 120초 시간창, 오탐방지 7종 내장
  -- GROUP BY lower() 기준 중복 제거 → 고유 쌍당 1회 신호 (day-over-day 누적)
  -- ⚠️ session_key는 GROUP BY에 포함하지 않음 (개인정보 원칙 유지)
  FOR v_canonical, v_member IN
    SELECT
      lower(original_query),
      lower(reformulated_query)
    FROM public.find_search_reformulation_pairs(
      p_lookback_days  => 30,
      p_window_seconds => 120
    )
    GROUP BY
      lower(original_query),
      lower(reformulated_query)
  LOOP
    -- canonical = lower(original_query): 검색 실패한 원 표현(사용자 의도)
    SELECT public.find_or_create_synonym_group(v_canonical) INTO v_group_id;

    IF v_group_id IS NULL THEN
      CONTINUE;
    END IF;

    -- reformulated_query를 동의어 후보로 등록
    -- p_source = 'query_reformulation': migration 252 CHECK 허용값
    -- p_threshold = 3: SYNONYM_PROMOTE_THRESHOLD 기본값과 일치 (§E SYN-4)
    PERFORM public.upsert_synonym_member(
      v_group_id,    -- p_group_id
      v_member,      -- p_term
      3,             -- p_threshold
      'query_reformulation'  -- p_source
    );
  END LOOP;
END;
$$;

-- 권한: service_role 전용 실행 (쌍방 안전 — SECURITY DEFINER이므로 내부 호출은 postgres 권한)
REVOKE ALL   ON FUNCTION public.run_search_reformulation_scan()
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.run_search_reformulation_scan()
  TO service_role;

-- ── 2. pg_cron 스케줄 등록 ────────────────────────────────────────────────────
-- 기존 cron_jobs.sql(migration 30) 컨벤션 준수: SELECT cron.schedule(...) 형식
-- '0 3 * * *' = 매일 새벽 3시 (UTC 기준 — Supabase 서버 시간대)
-- 트래픽 최저 시간대 선택 (hold_expiration_cleanup 00:00~, monthly_credit 00:01 이후)

SELECT cron.schedule(
  'search_reformulation_scan',
  '0 3 * * *',
  $$SELECT public.run_search_reformulation_scan();$$
);

-- ============================================================
-- ROLLBACK (역순 실행)
-- ============================================================
-- SELECT cron.unschedule('search_reformulation_scan');
-- DROP FUNCTION IF EXISTS public.run_search_reformulation_scan();
-- ============================================================
