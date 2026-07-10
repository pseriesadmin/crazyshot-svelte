-- Migration 96: code_mapping_groups 에 제휴상품 품번 자동 생성용 파트너 타입 컬럼 추가
-- 목적: is_partner_type = TRUE 인 그룹의 조합코드를 제휴상품 품번 발행에 사용

ALTER TABLE code_mapping_groups
  ADD COLUMN IF NOT EXISTS is_partner_type BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN code_mapping_groups.is_partner_type IS
  'TRUE인 그룹의 taxonomy_code_id를 제휴상품 품번 자동 생성(generate_product_code)에 사용.';
