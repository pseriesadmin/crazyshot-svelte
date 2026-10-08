-- Migration #671: NLSearch 정기 점검 스냅샷 테이블 (L-3)
-- 목적: 매일 03:30 KST cron(/api/cron/search-index-health)이 상품 검색 인덱스를 새로 빌드해 본 뒤
--   "숫자와 상태만" 기록한다 — 이상 징후(빌드 실패·후기 반영 급감·빌드 시간 급증) 비교용.
--   인덱스 자체는 서버 인스턴스 메모리에 있어 저장하지 않는다(nlsearch.md §5 "운용 부담 없음").
--   ⛔ 후기 원문·상품명·작성자 정보는 이 테이블에 절대 저장하지 않는다.
-- 서버 전용: RLS 켜짐 + 정책 없음 + anon·authenticated 명시 REVOKE
--   (public 스키마 ALTER DEFAULT PRIVILEGES가 신규 객체에 anon·authenticated 권한을 자동 부여 — Migration 251b/357)
-- 2026-10-08

CREATE TABLE IF NOT EXISTS public.search_index_snapshots (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  taken_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  indexed_products  INT         NOT NULL DEFAULT 0,   -- 인덱스에 들어간 상품(부모) 수
  reviewed_products INT         NOT NULL DEFAULT 0,   -- 후기가 반영된 상품 수
  review_rows       INT         NOT NULL DEFAULT 0,   -- 반영된 후기 건수 합
  weak_products     INT         NOT NULL DEFAULT 0,   -- 검색 문서가 빈약한 상품 수(이름 외 텍스트 거의 없음)
  build_ms          INT         NOT NULL DEFAULT 0,   -- 인덱스 빌드 소요(ms)
  status            TEXT        NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_search_index_snapshots_taken_at
  ON public.search_index_snapshots (taken_at DESC);

ALTER TABLE public.search_index_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.search_index_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.search_index_snapshots TO service_role;

COMMENT ON TABLE public.search_index_snapshots IS
  'NLSearch 정기 점검 기록(숫자·상태만). 후기 원문·상품명 없음. service_role 전용.';

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP TABLE IF EXISTS public.search_index_snapshots;
-- ============================================================
