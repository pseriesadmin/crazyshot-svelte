-- code_mapping_items에 년월 옵션 / 순번상한 컬럼 추가
ALTER TABLE public.code_mapping_items
  ADD COLUMN IF NOT EXISTS date_option TEXT NOT NULL DEFAULT 'ym'
    CHECK (date_option IN ('none', 'ym', 'ymd')),
  ADD COLUMN IF NOT EXISTS max_sequence INTEGER NOT NULL DEFAULT 999
    CHECK (max_sequence BETWEEN 1 AND 99999);

COMMENT ON COLUMN public.code_mapping_items.date_option IS '상품코드 날짜 포함 형식: none=없음, ym=연월(YYMM), ymd=연월일(YYMMDD)';
COMMENT ON COLUMN public.code_mapping_items.max_sequence IS '이 코드의 순번 상한값 (1~99999, 기본 999)';
