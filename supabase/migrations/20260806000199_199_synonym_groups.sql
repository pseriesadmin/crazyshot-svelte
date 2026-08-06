-- Migration 199: synonym_groups + synonym_group_members
-- §E 동의어 학습 기능 — 테이블·RPC·시드 데이터
-- 2026-08-06

-- ── 테이블 생성 ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.synonym_groups (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_term text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT synonym_groups_canonical_term_unique UNIQUE (canonical_term)
);

CREATE TABLE IF NOT EXISTS public.synonym_group_members (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id          uuid        NOT NULL REFERENCES public.synonym_groups(id) ON DELETE CASCADE,
  term              text        NOT NULL,
  source            text        NOT NULL CHECK (source IN ('seed', 'learned')),
  status            text        NOT NULL CHECK (status IN ('candidate', 'confirmed')),
  occurrence_count  int         NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),
  first_observed_at timestamptz NOT NULL DEFAULT now(),
  last_observed_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT synonym_group_members_group_term_unique UNIQUE (group_id, term)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_sgm_group_id    ON public.synonym_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_sgm_status      ON public.synonym_group_members(status);
CREATE INDEX IF NOT EXISTS idx_sg_canonical    ON public.synonym_groups(canonical_term);

-- ── RPC: find_or_create_synonym_group ─────────────────────────────────────────
-- canonical_term으로 그룹을 찾거나 없으면 생성 후 id 반환 (원자적)

CREATE OR REPLACE FUNCTION public.find_or_create_synonym_group(
  p_canonical_term text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.synonym_groups (canonical_term)
  VALUES (p_canonical_term)
  ON CONFLICT (canonical_term) DO NOTHING;

  SELECT id INTO v_id
  FROM public.synonym_groups
  WHERE canonical_term = p_canonical_term;

  RETURN v_id;
END;
$$;

-- ── RPC: upsert_synonym_member ────────────────────────────────────────────────
-- 학습 토큰을 candidate로 삽입하거나 occurrence_count를 1 증가.
-- occurrence_count >= p_threshold 이면 status를 confirmed으로 자동 승격.
-- seed(confirmed) 상태는 절대 candidate으로 강등하지 않는다.

CREATE OR REPLACE FUNCTION public.upsert_synonym_member(
  p_group_id  uuid,
  p_term      text,
  p_threshold int DEFAULT 3
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.synonym_group_members
    (group_id, term, source, status, occurrence_count)
  VALUES
    (p_group_id, p_term, 'learned', 'candidate', 1)
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

-- ── 시드 데이터: '파손' 그룹 ───────────────────────────────────────────────────

INSERT INTO public.synonym_groups (canonical_term)
VALUES ('파손')
ON CONFLICT (canonical_term) DO NOTHING;

WITH g AS (
  SELECT id FROM public.synonym_groups WHERE canonical_term = '파손'
)
INSERT INTO public.synonym_group_members (group_id, term, source, status, occurrence_count)
SELECT g.id, v.term, 'seed', 'confirmed', 1
FROM g,
  (VALUES ('깨짐'), ('떨어짐'), ('파손'), ('부딪힘'), ('흠집'), ('균열')) AS v(term)
ON CONFLICT (group_id, term) DO NOTHING;
