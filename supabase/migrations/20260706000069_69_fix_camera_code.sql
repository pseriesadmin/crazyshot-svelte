-- Migration #69: 카메라 분류 코드 정정
-- 문제: CA(더미, name='b') 가 살아있고 CAM(정상) 이 deleted_at 처리된 상태
-- 조치:
--   1. CA 코드 soft-delete
--   2. CAM 코드 deleted_at 복구 (NULL)
--   3. product_code_sequences CA 행 삭제 → CAM next_seq=3 (001·002 발행 완료)
--   4. CS-CA-all-001/002 → CS-CAM-all-001/002 재발행

-- ─────────────────────────────────────────────
-- 1. CA 더미 코드 soft-delete
-- ─────────────────────────────────────────────
UPDATE product_category_codes
SET    deleted_at = NOW()
WHERE  code = 'CA'
  AND  deleted_at IS NULL;

-- ─────────────────────────────────────────────
-- 2. CAM 코드 삭제 취소 (복구)
-- ─────────────────────────────────────────────
UPDATE product_category_codes
SET    deleted_at = NULL
WHERE  code = 'CAM';

-- ─────────────────────────────────────────────
-- 3. 시퀀스 정리
--    - CA 행 삭제 (더미 시퀀스 제거)
--    - CAM 행 upsert: next_seq = 3 (001·002 이미 발행됨)
-- ─────────────────────────────────────────────
DELETE FROM product_code_sequences
WHERE  category_code = 'CA';

INSERT INTO product_code_sequences (category_code, year_month, next_seq)
VALUES ('CAM', 'all', 3)
ON CONFLICT (category_code, year_month)
DO UPDATE SET next_seq = 3;

-- ─────────────────────────────────────────────
-- 4. 품번 재발행
--    CS-CA-all-001 → CS-CAM-all-001
--    CS-CA-all-002 → CS-CAM-all-002
-- ─────────────────────────────────────────────
UPDATE products
SET    product_code = 'CS-CAM-all-001'
WHERE  product_code = 'CS-CA-all-001'
  AND  deleted_at IS NULL;

UPDATE products
SET    product_code = 'CS-CAM-all-002'
WHERE  product_code = 'CS-CA-all-002'
  AND  deleted_at IS NULL;
