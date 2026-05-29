-- ★ MIGRATION: 12_order_reservations.sql
-- Schema version: v5.46
-- Description: M3 Orders — junction table (order ↔ rental_reservation N:N, 1NF)
-- Dependencies: 11_orders.sql, 10_rental_reservations.sql
-- Author: Stephen Cconzy
-- Date: 2026-05-29
--
-- 1NF 정규화: reservation_ids UUID[] 배열 → 독립 junction 테이블로 분리
-- 하나의 주문에 여러 예약 포함 가능 (패키지 촬영 장비 세트 등)

CREATE TABLE IF NOT EXISTS order_reservations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  reservation_id UUID NOT NULL REFERENCES rental_reservations(id) ON DELETE RESTRICT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(order_id, reservation_id)
);

CREATE INDEX idx_order_reservations_order_id       ON order_reservations(order_id);
CREATE INDEX idx_order_reservations_reservation_id ON order_reservations(reservation_id);

ALTER TABLE order_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_reservations: 본인 조회" ON order_reservations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_reservations.order_id
        AND o.user_id = auth.uid()
    )
  );

CREATE POLICY "order_reservations: 관리자 전체" ON order_reservations
  FOR ALL USING (is_admin());
