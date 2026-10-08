-- Migration #680: 크레이지챗 지식 저장소 — 매일 새벽 정리 결과(재료별 요약본) + 실행 기록
-- 2026-10-08 | Stephen 지시("크레이지챗이 매일 새벽에 빠른답변·상품 색인·상품 후기·고객 예약을 정리해 지식 저장소에 저장")
-- TDD: src/__tests__/server/crazychatKnowledge.test.ts
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh). ⛔ 아직 어느 DB에도 적용하지 않았다.
--
-- ① crazychat_knowledge: 재료(faq/product/review/reservation)별 1행. digest(JSONB)는 집계·단어 빈도만 담는다 — 고객 식별 정보·후기 원문 금지.
-- ② crazychat_knowledge_runs: 정리 작업 1회의 기록(재료별 상태·건수·소요시간·오류 요약).
-- 서버 전용 테이블: RLS 활성화 + 정책 없음 + anon/authenticated 권한 회수, service_role만 접근.
-- ROLLBACK: DROP TABLE public.crazychat_knowledge_runs; DROP TABLE public.crazychat_knowledge;

CREATE TABLE IF NOT EXISTS public.crazychat_knowledge (
  source        TEXT PRIMARY KEY CHECK (source IN ('faq', 'product', 'review', 'reservation')),
  digest        JSONB NOT NULL,
  content_hash  TEXT NOT NULL,
  item_count    INTEGER NOT NULL DEFAULT 0,
  built_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  build_ms      INTEGER,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crazychat_knowledge_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at   TIMESTAMPTZ NOT NULL,
  finished_at  TIMESTAMPTZ NOT NULL,
  ok           BOOLEAN NOT NULL,
  sources      JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS crazychat_knowledge_runs_started_idx ON public.crazychat_knowledge_runs (started_at DESC);

ALTER TABLE public.crazychat_knowledge      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crazychat_knowledge_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crazychat_knowledge      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.crazychat_knowledge_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.crazychat_knowledge      TO service_role;
GRANT ALL ON public.crazychat_knowledge_runs TO service_role;

COMMENT ON TABLE public.crazychat_knowledge      IS '크레이지챗 지식 저장소: 매일 새벽 재료별 요약본(집계·단어 빈도만, 개인정보 금지).';
COMMENT ON TABLE public.crazychat_knowledge_runs IS '크레이지챗 지식 저장소 정리 작업 실행 기록.';
