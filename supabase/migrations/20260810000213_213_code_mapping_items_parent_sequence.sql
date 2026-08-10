-- Migration #213: code_mapping_items — max_sequence NULLABLE 완화 + parent_max_sequence 신규 컬럼
-- 설계: 순번 2단 계층 채번(부모/자식)을 위한 DB 스키마 변경 (2026-08-10)
--
-- max_sequence 역할 변경:
--   이전: NOT NULL DEFAULT 999 (항상 자식 전역 순번상한을 의미)
--   이후: NULLABLE (NULL = 순번 상한 미설정, 값이 있으면 순번2(자식) 상한)
--   기존 행의 999 기본값은 그대로 유지됨 (데이터 변경 없음)
--
-- parent_max_sequence 신규:
--   NULL = 순번1(부모) 미사용 → 기존 1개-순번 또는 완전 미설정과 동일
--   값이 있으면 2단 계층 채번 활성화 + 순번1(부모) 상한

-- ① max_sequence NOT NULL 제거 + DEFAULT 제거 + CHECK 재작성 (NULL 허용)
ALTER TABLE public.code_mapping_items
  ALTER COLUMN max_sequence DROP NOT NULL,
  ALTER COLUMN max_sequence DROP DEFAULT;

-- ② 기존 CHECK 제약 제거 후 NULL 허용 형태로 재추가
ALTER TABLE public.code_mapping_items
  DROP CONSTRAINT IF EXISTS code_mapping_items_max_sequence_check;

ALTER TABLE public.code_mapping_items
  ADD CONSTRAINT code_mapping_items_max_sequence_check
    CHECK (max_sequence IS NULL OR max_sequence BETWEEN 1 AND 9999999);

-- ③ parent_max_sequence 신규 컬럼 (순번1, 부모 등록 시 product_parent_sequences에서 소비)
ALTER TABLE public.code_mapping_items
  ADD COLUMN IF NOT EXISTS parent_max_sequence INT
    CONSTRAINT code_mapping_items_parent_max_sequence_check
    CHECK (parent_max_sequence BETWEEN 1 AND 9999999);

COMMENT ON COLUMN public.code_mapping_items.max_sequence IS
  '순번2(자식) 상한. NULL = 미설정(상한 없음), 값이 있으면 자식 채번 초과 시 예외 발생. 기존 행 값 유지.';

COMMENT ON COLUMN public.code_mapping_items.parent_max_sequence IS
  '순번1(부모) 상한. NULL = 순번1 미사용(기존 1개-순번 또는 미설정). 값이 있으면 2단 계층 채번 활성화.';
