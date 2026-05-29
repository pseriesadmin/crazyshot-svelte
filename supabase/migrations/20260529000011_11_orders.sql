-- ★ MIGRATION: 11_orders.sql
-- Schema version: v5.46
-- Description: M3 Orders — order master table
-- Dependencies: 03_user_profiles.sql, 02_enums.sql
-- Author: Stephen Cconzy
-- Date: 2026-05-29

CREATE TABLE IF NOT EXISTS orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  order_number    VARCHAR(50) NOT NULL UNIQUE,  -- 예: ORD-20260529-XXXXXX
  total_amount    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(total_amount >= 0),
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(discount_amount >= 0),
  final_amount    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(final_amount >= 0),
  payment_status  payment_status_enum NOT NULL DEFAULT 'pending',
  order_status    VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK(order_status IN ('pending', 'processing', 'completed', 'cancelled')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_orders_user_id        ON orders(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_order_number   ON orders(order_number);
CREATE INDEX idx_orders_payment_status ON orders(payment_status) WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_created_at     ON orders(created_at DESC);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orders: 본인 조회" ON orders
  FOR SELECT USING (user_id = auth.uid() AND deleted_at IS NULL);

CREATE POLICY "orders: 본인 생성" ON orders
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "orders: 관리자 전체" ON orders
  FOR ALL USING (is_admin());

CREATE TRIGGER set_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ★ order_number 자동 생성 함수
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TEXT
LANGUAGE plpgsql AS $$
BEGIN
  RETURN 'ORD-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' ||
         UPPER(SUBSTRING(gen_random_uuid()::TEXT, 1, 6));
END;
$$;
