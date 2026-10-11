-- 692_nlsearch_shadow_observations.sql
-- B-4(2026-10-10): 의미 점수 그림자(관찰) 기록. 검색 응답은 바꾸지 않고, "의미 결합을 켰다면 상위 결과가 얼마나 달라졌을지"만 숫자로 남긴다.
-- ⛔ 질의 원문·상품명·사용자 식별자를 저장하지 않는다(숫자·불리언·search_logs 연결 id만). 원문은 기존 search_logs가 이미 보유.
-- 보존: 90일(nlsearch-vectors 크론이 오래된 행을 지움). 권한: RLS ON·정책 0건·service_role 전용.
-- 롤백: DROP TABLE public.nlsearch_shadow_observations;

CREATE TABLE IF NOT EXISTS public.nlsearch_shadow_observations (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at            timestamptz NOT NULL DEFAULT now(),
  search_log_id         uuid,
  query_chars           smallint    NOT NULL CHECK (query_chars >= 0),
  result_count_current  smallint    NOT NULL CHECK (result_count_current >= 0),
  result_count_blend    smallint    NOT NULL CHECK (result_count_blend >= 0),
  overlap_k             smallint    NOT NULL CHECK (overlap_k >= 0),
  new_entrants          smallint    NOT NULL CHECK (new_entrants >= 0),
  dropped               smallint    NOT NULL CHECK (dropped >= 0),
  top1_same             boolean     NOT NULL,
  would_fill_zero       boolean     NOT NULL,
  weight                real        NOT NULL,
  model_vocab           integer     NOT NULL DEFAULT 0,
  latency_ms            integer     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS nlsearch_shadow_observations_created_idx
  ON public.nlsearch_shadow_observations (created_at DESC);

ALTER TABLE public.nlsearch_shadow_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nlsearch_shadow_observations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.nlsearch_shadow_observations TO service_role;
