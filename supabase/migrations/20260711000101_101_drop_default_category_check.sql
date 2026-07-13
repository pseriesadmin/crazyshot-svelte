-- Migration #101: code_mapping_groups.default_category CHECK 제약 삭제
-- 목적: default_category는 자유 문자열 카테고리 키여야 함
--       #91/#100에서 추가한 고정 목록 제약이 불필요한 제한이었음

ALTER TABLE public.code_mapping_groups
  DROP CONSTRAINT IF EXISTS code_mapping_groups_default_category_check;
