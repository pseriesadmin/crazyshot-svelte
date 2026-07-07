-- Migration #67: products 테이블 상품 카피(caption) 컬럼 추가
-- product_caption: 상품 대표 설명 (사용자 화면 상품명 아래 노출, 20자 이내)

ALTER TABLE products ADD COLUMN IF NOT EXISTS product_caption VARCHAR(20);
