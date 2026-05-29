-- ★ MIGRATION: 09_cart_items.sql
-- Schema version: v5.46
-- Description: M1 Products — shopping cart (Zone 1~4 model)
-- Dependencies: 04_products.sql, 05_assets.sql, 07_product_options.sql, 02_enums.sql, 03_user_profiles.sql
-- Author: Stephen Cconzy
-- Date: 2026-05-29
--
-- Cart zone model:
--   Zone 1: 옵션 선택 (accessories, services, bundles)
--   Zone 2: 배송/날짜 선택
--   Zone 3: 할인 적용 (쿠폰, 멤버십, 포인트)
--   Zone 4: 최종 결제

CREATE TABLE IF NOT EXISTS cart_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id          UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  asset_id            UUID REFERENCES assets(id) ON DELETE SET NULL,
  duration_type       duration_type_enum NOT NULL,
  quantity            SMALLINT NOT NULL DEFAULT 1 CHECK(quantity > 0),
  rental_start_date   DATE NOT NULL,
  rental_end_date     DATE NOT NULL CHECK(rental_end_date >= rental_start_date),
  selected_options    UUID[] NOT NULL DEFAULT '{}',  -- FK product_options.id 배열
  zone                SMALLINT NOT NULL DEFAULT 1 CHECK(zone BETWEEN 1 AND 4),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cart_items_user_id ON cart_items(user_id);
CREATE INDEX idx_cart_items_product ON cart_items(product_id);

ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;

-- 본인 장바구니만 접근
CREATE POLICY "cart_items: 본인 전체" ON cart_items
  FOR ALL USING (user_id = auth.uid());

CREATE TRIGGER set_cart_items_updated_at
  BEFORE UPDATE ON cart_items
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
