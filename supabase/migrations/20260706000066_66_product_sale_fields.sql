-- Migration #66: products 테이블 판매 관련 컬럼 추가
-- sale_price: 판매금액 (대여 외 판매 가능한 상품)
-- sale_only:  판매만 가능 플래그 (true 시 대여 요금 미노출)

ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_price INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_only  BOOLEAN NOT NULL DEFAULT false;
