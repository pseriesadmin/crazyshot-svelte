-- migration 125: products 대여 정책 컬럼 3종 추가
-- 소스: /cms/set/rental (구현 완료)
--   rental_period_options → allowed_period_ids (대여 기간 조건)
--   rental_method_options → allowed_method_ids (대여 방식)
--   pickup_points         → allowed_pickup_ids (방문 지점)

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS allowed_period_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  ADD COLUMN IF NOT EXISTS allowed_method_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  ADD COLUMN IF NOT EXISTS allowed_pickup_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

-- rollback:
-- ALTER TABLE products
--   DROP COLUMN IF EXISTS allowed_period_ids,
--   DROP COLUMN IF EXISTS allowed_method_ids,
--   DROP COLUMN IF EXISTS allowed_pickup_ids;
