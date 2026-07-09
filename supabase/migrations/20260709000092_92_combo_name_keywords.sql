-- Migration #92: code_mapping_items 조합행 코드명·키워드 추가
-- 목적: 조합 행 단위로 이름(label)과 검색 키워드를 저장해 상품등록 시 선택 안내 강화

ALTER TABLE public.code_mapping_items
  ADD COLUMN IF NOT EXISTS combo_name     TEXT,
  ADD COLUMN IF NOT EXISTS combo_keywords TEXT[] DEFAULT '{}';

COMMENT ON COLUMN public.code_mapping_items.combo_name IS
  '조합 행 레이블 (예: "바디+렌즈 렌탈") — 동일 combo_row_id 아이템 전체 공유';

COMMENT ON COLUMN public.code_mapping_items.combo_keywords IS
  '조합 행 검색 키워드 배열 — 동일 combo_row_id 아이템 전체 공유';
