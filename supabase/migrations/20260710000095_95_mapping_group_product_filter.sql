-- Migration 95: code_mapping_groups 에 상품목록 카테고리 필터 노출 제어 컬럼 추가
-- 목적: 코드조합그룹을 상품목록 '카테고리 보기' 탭바에 노출할지 여부를 관리자가 제어

ALTER TABLE code_mapping_groups
  ADD COLUMN IF NOT EXISTS show_in_product_filter BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN code_mapping_groups.show_in_product_filter IS
  '상품목록 카테고리 탭바에 이 그룹을 노출할지 여부. TRUE인 그룹만 /cms/products 카테고리 필터에 표시됨.';
