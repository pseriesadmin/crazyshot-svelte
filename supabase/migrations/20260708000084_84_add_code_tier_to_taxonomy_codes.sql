-- Migration 84: product_category_codes에 code_tier 컬럼 추가
-- 목적: 코드 생성 시 설정한 유형(대분류/중분류/소분류)을 DB에 영구 저장
--       상품매핑 화면에서 코드 유형별 필터링/조합에 활용
-- 생성: 2026-07-08

-- 1. ENUM 타입 생성
CREATE TYPE public.code_tier AS ENUM ('major', 'middle', 'minor');

-- 2. 컬럼 추가 (NULL 허용 — 기존 레코드 호환)
ALTER TABLE public.product_category_codes
  ADD COLUMN IF NOT EXISTS code_tier public.code_tier NULL;

-- 3. 기존 레코드: depth 기반으로 code_tier 백필
UPDATE public.product_category_codes
SET code_tier = CASE
  WHEN depth = 0 THEN 'major'::public.code_tier
  WHEN depth = 1 THEN 'middle'::public.code_tier
  ELSE                 'minor'::public.code_tier
END
WHERE code_tier IS NULL
  AND deleted_at IS NULL;

-- 4. 인덱스 (매핑 조회 시 code_tier 필터 성능)
CREATE INDEX IF NOT EXISTS idx_taxonomy_codes_code_tier
  ON public.product_category_codes (code_tier)
  WHERE deleted_at IS NULL;
