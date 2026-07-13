-- Migration #80: Stage DB 레거시 가격 컬럼 기본값 추가
-- base_price_daily/weekly/monthly는 migration 이전 수동 생성 컬럼 (price_rules로 대체).
-- NOT NULL + 기본값 없음 → INSERT 차단. 기본값 0 추가로 해소.
ALTER TABLE products
  ALTER COLUMN base_price_daily  SET DEFAULT 0,
  ALTER COLUMN base_price_weekly SET DEFAULT 0,
  ALTER COLUMN base_price_monthly SET DEFAULT 0;
