-- Migration #214: product_parent_sequences + product_child_sequences_by_parent 신규 테이블
-- 설계: 순번 2단 계층 채번을 위한 전용 카운터 테이블 (2026-08-10)
--
-- 기존 product_code_sequences와 분리하는 이유:
--   - product_code_sequences는 "이 카테고리+연월 안에서 몇 번째 자식인가"를 공유 카운터로 관리
--   - 2단 모드에서는 "몇 번째 부모"와 "특정 부모 안에서 몇 번째 자식"이 별개 개념
--   - 같은 키스페이스에 섞으면 채번 정합이 깨짐 → 완전 분리가 유일한 안전한 설계
--
-- 채번 패턴 (두 테이블 모두 동일 — 기존 product_code_sequences와 완전히 같은 패턴):
--   INSERT ... VALUES(..., 2) ON CONFLICT DO UPDATE SET next_seq = next_seq + 1
--   RETURNING next_seq - 1 → 첫 호출 = 1, 두 번째 = 2, 세 번째 = 3, ...
--
--   product_parent_sequences:
--     순번1(부모) 전용, 부모 상품 등록 시 소비, 1부터 시작
--
--   product_child_sequences_by_parent:
--     순번2(자식) 전용, 특정 부모 기준, 1부터 시작
--     (빠른재고등록 첫 실행 = 001, 두 번째 = 002, ...)
--     ※ "000"은 실물 재고가 아닌 명목 기준코드(표시용)이며 실제 채번되는 자식은 001부터

-- ─────────────────────────────────────────────────────────────────────────────
-- 순번1(부모) 전용 카운터 테이블
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_parent_sequences (
  category_code TEXT NOT NULL,
  year_month    TEXT NOT NULL,
  next_seq      INT  NOT NULL DEFAULT 2,  -- INSERT 시 2를 넣어 RETURNING next_seq-1=1 얻음
  PRIMARY KEY (category_code, year_month)
);

COMMENT ON TABLE public.product_parent_sequences IS
  '순번1(부모) 전용 카운터. category_code + year_month 단위로 부모 상품 등록 순번을 단조증가 관리.
   INSERT ... ON CONFLICT DO UPDATE SET next_seq = next_seq + 1 패턴으로 원자적 채번.
   순번은 1부터 시작: 첫 INSERT next_seq=2 → RETURNING next_seq-1=1.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 순번2(자식) 전용 카운터 테이블 — 부모 기준 독립 카운터
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_child_sequences_by_parent (
  parent_product_id UUID NOT NULL,
  next_seq          INT  NOT NULL DEFAULT 2,  -- INSERT 시 2를 넣어 RETURNING next_seq-1=1 얻음
  PRIMARY KEY (parent_product_id)
);

COMMENT ON TABLE public.product_child_sequences_by_parent IS
  '순번2(자식) 전용 카운터. parent_product_id 단위로 자식 재고 등록 순번을 1부터 단조증가 관리.
   INSERT ... ON CONFLICT DO UPDATE SET next_seq = next_seq + 1 패턴으로 원자적 채번.
   순번은 1부터 시작: 첫 INSERT next_seq=2 → RETURNING next_seq-1=1 (첫 자식=001).
   부모가 다르면 카운터 완전 독립 (각자 1부터 다시 시작).
   ※ "000"은 실물 재고가 아닌 UI 표시용 placeholder — 실제 채번 자식은 항상 001부터 시작.';

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS + 권한 설정 (기존 product_code_sequences와 동일 패턴)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.product_parent_sequences          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_child_sequences_by_parent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_parent_sequences"
  ON public.product_parent_sequences
  FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "service_role_all_child_sequences_by_parent"
  ON public.product_child_sequences_by_parent
  FOR ALL
  USING (auth.role() = 'service_role');

REVOKE ALL ON public.product_parent_sequences          FROM PUBLIC;
REVOKE ALL ON public.product_child_sequences_by_parent FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.product_parent_sequences          TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.product_child_sequences_by_parent TO service_role;
