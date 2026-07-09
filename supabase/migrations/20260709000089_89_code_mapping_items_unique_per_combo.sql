-- (group_id, taxonomy_code_id) 유니크 제약 → (group_id, combo_row_id, taxonomy_code_id)로 교체
-- 이유: 동일 코드를 다른 조합 행에 추가 가능해야 함 (같은 조합 내 중복만 방지)

ALTER TABLE public.code_mapping_items
  DROP CONSTRAINT IF EXISTS code_mapping_items_group_id_taxonomy_code_id_key;

ALTER TABLE public.code_mapping_items
  ADD CONSTRAINT code_mapping_items_group_combo_code_key
  UNIQUE (group_id, combo_row_id, taxonomy_code_id);
