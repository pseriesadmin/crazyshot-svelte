-- Migration #81: products.parent_product_id 컬럼 추가
-- 목적: 동일 상품 재고 추가 시 부모-자식 관계 연결
--       Root 상품: parent_product_id IS NULL (기존 상품 전부 해당 — 하위 호환)
--       재고 추가 복제본: parent_product_id = 원본.id

ALTER TABLE products
  ADD COLUMN parent_product_id UUID REFERENCES products(id) ON DELETE SET NULL;

CREATE INDEX idx_products_parent_id ON products(parent_product_id)
  WHERE parent_product_id IS NOT NULL AND deleted_at IS NULL;
