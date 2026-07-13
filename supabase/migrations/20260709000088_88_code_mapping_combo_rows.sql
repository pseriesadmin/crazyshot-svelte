-- code_mapping_items에 combo_row_id 추가
-- 같은 combo_row_id를 가진 아이템들이 하나의 조합 행을 구성한다
ALTER TABLE public.code_mapping_items
  ADD COLUMN IF NOT EXISTS combo_row_id UUID;

-- 기존 아이템: 각각 고유한 combo_row_id 부여 (1아이템 = 1행)
UPDATE public.code_mapping_items
SET combo_row_id = gen_random_uuid()
WHERE combo_row_id IS NULL;

-- 신규 삽입 기본값 설정 + NOT NULL 제약
ALTER TABLE public.code_mapping_items
  ALTER COLUMN combo_row_id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN combo_row_id SET NOT NULL;

COMMENT ON COLUMN public.code_mapping_items.combo_row_id IS
  '조합 행 ID: 동일 combo_row_id를 가진 아이템들이 하나의 코드 조합 행으로 표시됨';
