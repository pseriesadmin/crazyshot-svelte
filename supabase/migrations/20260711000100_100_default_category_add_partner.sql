-- Migration #100: default_category CHECK 제약에 'partner' 추가
-- 목적: 협력사 조합코드그룹에 default_category = 'partner' 설정 허용

ALTER TABLE public.code_mapping_groups
  DROP CONSTRAINT IF EXISTS code_mapping_groups_default_category_check;

ALTER TABLE public.code_mapping_groups
  ADD CONSTRAINT code_mapping_groups_default_category_check
    CHECK (default_category IN (
      'camera','lens','camcorder','action_cam','drone',
      'lighting','audio','accessory','package','partner'
    ));

-- 협력사 그룹 default_category 설정
UPDATE public.code_mapping_groups
  SET default_category = 'partner'
  WHERE name = '협력사' AND default_category IS NULL;
