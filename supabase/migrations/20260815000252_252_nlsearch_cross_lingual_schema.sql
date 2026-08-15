-- Migration 252: NLSearch 능동형 자연어 학습 — DB 스키마 확장 (§A-1)
-- synonym_group_members.source CHECK 확장:
--   추가: cross_lingual_pattern (이중언어 괄호 패턴 학습)
--         query_reformulation   (재검색 행동 패턴 학습)
-- upsert_synonym_member RPC: p_source 파라미터 추가 (DEFAULT 'learned', 기존 호출 하위호환)
-- 2026-08-15

-- ── 1. source CHECK 제약 교체 ─────────────────────────────────────────────────
-- inline CHECK로 생성된 제약은 PostgreSQL이 자동 이름을 붙이므로 pg_constraint에서 동적 조회.

DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT c.conname INTO v_conname
  FROM   pg_constraint c
  JOIN   pg_class      t ON t.oid = c.conrelid
  JOIN   pg_namespace  n ON n.oid = t.relnamespace
  WHERE  n.nspname = 'public'
    AND  t.relname = 'synonym_group_members'
    AND  c.contype = 'c'                         -- CHECK
    AND  pg_get_constraintdef(c.oid) LIKE '%source%'
  LIMIT 1;

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.synonym_group_members DROP CONSTRAINT %I', v_conname);
  END IF;
END;
$$;

ALTER TABLE public.synonym_group_members
  ADD CONSTRAINT sgm_source_check
  CHECK (source IN ('seed', 'learned', 'cross_lingual_pattern', 'query_reformulation'));

-- ── 2. upsert_synonym_member: 기존 3-param 오버로드 제거 후 4-param DEFAULT 버전 교체 ──
-- PostgreSQL은 시그니처(파라미터 타입)로 함수를 구분한다.
-- 기존 (uuid, text, int) 오버로드를 먼저 DROP하고 (uuid, text, int, text) DEFAULT 버전을
-- CREATE OR REPLACE 해야 3-param 호출 시 모호성 없이 동작한다.

DROP FUNCTION IF EXISTS public.upsert_synonym_member(uuid, text, int);

CREATE OR REPLACE FUNCTION public.upsert_synonym_member(
  p_group_id  uuid,
  p_term      text,
  p_threshold int  DEFAULT 3,
  p_source    text DEFAULT 'learned'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- p_source 유효성 보호 (CHECK 제약과 이중 검사, 잘못된 값이면 무시)
  IF p_source NOT IN ('seed', 'learned', 'cross_lingual_pattern', 'query_reformulation') THEN
    p_source := 'learned';
  END IF;

  INSERT INTO public.synonym_group_members
    (group_id, term, source, status, occurrence_count)
  VALUES
    (p_group_id, p_term, p_source, 'candidate', 1)
  ON CONFLICT (group_id, term) DO UPDATE SET
    occurrence_count  = synonym_group_members.occurrence_count + 1,
    last_observed_at  = now(),
    status = CASE
      WHEN synonym_group_members.status = 'confirmed' THEN 'confirmed'
      WHEN (synonym_group_members.occurrence_count + 1) >= p_threshold THEN 'confirmed'
      ELSE synonym_group_members.status
    END;
END;
$$;

-- ── 3. 권한: service_role 전용 실행 ──────────────────────────────────────────
REVOKE ALL ON FUNCTION public.upsert_synonym_member(uuid, text, int, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.upsert_synonym_member(uuid, text, int, text)
  TO service_role;

-- ============================================================
-- ROLLBACK (역순 실행)
-- ============================================================
-- DROP FUNCTION IF EXISTS public.upsert_synonym_member(uuid, text, int, text);
--
-- CREATE OR REPLACE FUNCTION public.upsert_synonym_member(
--   p_group_id  uuid,
--   p_term      text,
--   p_threshold int DEFAULT 3
-- )
-- RETURNS void
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- AS $$
-- BEGIN
--   INSERT INTO public.synonym_group_members
--     (group_id, term, source, status, occurrence_count)
--   VALUES
--     (p_group_id, p_term, 'learned', 'candidate', 1)
--   ON CONFLICT (group_id, term) DO UPDATE SET
--     occurrence_count  = synonym_group_members.occurrence_count + 1,
--     last_observed_at  = now(),
--     status = CASE
--       WHEN synonym_group_members.status = 'confirmed' THEN 'confirmed'
--       WHEN (synonym_group_members.occurrence_count + 1) >= p_threshold THEN 'confirmed'
--       ELSE synonym_group_members.status
--     END;
-- END;
-- $$;
--
-- REVOKE ALL ON FUNCTION public.upsert_synonym_member(uuid, text, int)
--   FROM PUBLIC, anon, authenticated;
-- GRANT  EXECUTE ON FUNCTION public.upsert_synonym_member(uuid, text, int)
--   TO service_role;
--
-- ALTER TABLE public.synonym_group_members DROP CONSTRAINT IF EXISTS sgm_source_check;
-- ALTER TABLE public.synonym_group_members
--   ADD CONSTRAINT synonym_group_members_source_check
--   CHECK (source IN ('seed', 'learned'));
-- ============================================================
