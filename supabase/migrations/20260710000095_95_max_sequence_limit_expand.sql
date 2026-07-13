-- Migration #95: max_sequence 상한 확장 — 9999999(백만)으로 확대
-- 이유: 코드 순번 상한을 기존 99,999에서 9,999,999(백만 단위)로 확장
--      UI/서버 검증은 이미 9999999으로 수정 완료 (이 마이그레이션은 DB CHECK 제약 정합)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. max_sequence CHECK 제약 갱신 (99999 → 9999999)
ALTER TABLE code_mapping_items
  DROP CONSTRAINT IF EXISTS code_mapping_items_max_sequence_check,
  ADD  CONSTRAINT code_mapping_items_max_sequence_check
       CHECK (max_sequence BETWEEN 1 AND 9999999);

-- 2. 컬럼 코멘트 업데이트
COMMENT ON COLUMN public.code_mapping_items.max_sequence
  IS '이 코드의 순번 상한값 (1~9999999, 기본 999)';
