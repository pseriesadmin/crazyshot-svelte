-- Migration 109: rental_reservations.product_id 인덱스 (긴급)
-- 근거: Migration 61에서 product_id가 bigint→UUID로 교체됐으나 인덱스 미재생성.
-- cms/products load()에서 status='in_use' + product_id 필터 쿼리가
-- status 인덱스 → product_id 메모리 필터 경로. 100K rows에서 즉시 체감 저하.

-- NOTE: rental_reservations에 deleted_at 컬럼 없음 — WHERE 조건 제거
CREATE INDEX IF NOT EXISTS idx_rental_reservations_product_id
  ON rental_reservations(product_id);
