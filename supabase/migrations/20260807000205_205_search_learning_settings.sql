-- Migration 205: search_learning_settings
-- §J J-1: 검색기록 기반 키워드 자동승격 파라미터 런타임 튜닝 테이블 (싱글턴 1행)
-- 목적: product_search_stats.click_count 누적 후 인덱스 키워드 자동승격 임계값을
--       코드 배포 없이 Supabase 대시보드에서 직접 조정 가능하게 함.
-- 패턴: synonym_learning_settings(migration 200)와 동일 싱글턴 구조 — 별도 테이블
-- 2026-08-07

-- ── 테이블 생성 ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.search_learning_settings (
  -- 싱글턴 보장: id = 1 고정 (CHECK 제약으로 다른 값 삽입 불가)
  id                  INTEGER     PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- §J: product_search_stats.click_count >= 이 값이면 search_term을 인덱스 키워드에 자동 추가
  -- productSearchIndex.ts 빌드 시 이 임계값으로 product_search_stats 필터링
  -- 하드코딩 fallback: 3 (synonymLearning.ts의 SYNONYM_PROMOTE_THRESHOLD와 동일 기본값)
  promote_threshold   INTEGER     NOT NULL DEFAULT 3
                                  CHECK (promote_threshold >= 1),

  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 싱글턴 초기 행 삽입 ─────────────────────────────────────────────────────────

INSERT INTO public.search_learning_settings DEFAULT VALUES
ON CONFLICT (id) DO NOTHING;

-- ── RLS: service_role만 접근 가능 ───────────────────────────────────────────────

-- RLS 활성화 — 정책을 별도로 추가하지 않으면 anon/authenticated는 자동 차단됩니다.
-- service_role은 Supabase 설계상 RLS를 우회하므로 별도 정책 불필요.
ALTER TABLE public.search_learning_settings ENABLE ROW LEVEL SECURITY;

-- ── 코멘트 ───────────────────────────────────────────────────────────────────────

COMMENT ON TABLE public.search_learning_settings IS
  '§J J-1: 검색기록 기반 키워드 자동승격 파라미터 (싱글턴). Supabase 대시보드에서 직접 수정, 코드 배포 불필요. productSearchIndex.ts가 60초 TTL 캐시로 읽어 인덱스 빌드에 반영.';

COMMENT ON COLUMN public.search_learning_settings.promote_threshold IS
  '§J: product_search_stats.click_count >= 이 값이면 search_term을 해당 상품 인덱스 키워드에 자동추가. 기본값 3 — 3번 이상 클릭된 검색어만 승격.';

-- ── ROLLBACK ─────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS public.search_learning_settings;
-- ─────────────────────────────────────────────────────────────────────────────────
