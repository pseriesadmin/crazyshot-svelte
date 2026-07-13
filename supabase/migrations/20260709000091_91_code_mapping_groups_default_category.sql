-- Migration #91: code_mapping_groups에 default_category 추가
-- 목적: 상품등록 시 그룹 선택만으로 products.category 자동 설정
--       (폴백 유형 선택 UI 제거 → 그룹 메타데이터로 대체)

ALTER TABLE public.code_mapping_groups
  ADD COLUMN IF NOT EXISTS default_category TEXT
    CHECK (default_category IN ('camera','lens','camcorder','action_cam','drone','lighting','audio','accessory','package'));

COMMENT ON COLUMN public.code_mapping_groups.default_category IS
  '이 그룹으로 등록되는 상품의 기본 카테고리 (products.category 자동 설정)';

-- 기존 그룹 데이터 매핑 (그룹명 기준)
UPDATE public.code_mapping_groups SET default_category = 'lens'   WHERE name = '렌즈';
UPDATE public.code_mapping_groups SET default_category = 'camera' WHERE name = '카메라';
