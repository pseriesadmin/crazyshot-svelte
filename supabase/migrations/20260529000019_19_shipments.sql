-- ★ MIGRATION: 19_shipments.sql
-- Schema version: v5.46
-- Description: M5 Shipment — delivery and return logistics tracking
-- Dependencies: 10_rental_reservations.sql, 02_enums.sql
-- Author: Stephen Cconzy
-- Date: 2026-05-29
--
-- 배송 방식:
--   crazydelivery — 크레이지샷 자체 배달
--   quick         — 퀵서비스
--   locker        — 스마트 보관함
--   visit         — 직접 방문 수령
--   airport       — 공항 수령 (외국인)
--
-- 두발히어로 체인로지스 API 연동 (tracking_number)

CREATE TABLE IF NOT EXISTS shipments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id        UUID NOT NULL REFERENCES rental_reservations(id) ON DELETE RESTRICT,
  shipment_type         VARCHAR(10) NOT NULL CHECK(shipment_type IN ('pickup', 'return')),
  method                shipment_method_enum NOT NULL,
  status                shipment_status_enum NOT NULL DEFAULT 'preparing',
  tracking_number       VARCHAR(100),
  scheduled_date        DATE NOT NULL,
  actual_date           DATE,
  carrier               VARCHAR(100),
  carrier_contact       VARCHAR(20),
  delivery_address      JSONB,
  special_instructions  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

CREATE INDEX idx_shipments_reservation_id ON shipments(reservation_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_shipments_status         ON shipments(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_shipments_tracking       ON shipments(tracking_number) WHERE tracking_number IS NOT NULL;

ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shipments: 본인 조회" ON shipments
  FOR SELECT USING (
    deleted_at IS NULL AND
    EXISTS (
      SELECT 1 FROM rental_reservations rr
      WHERE rr.id = shipments.reservation_id
        AND rr.user_id = auth.uid()
    )
  );

CREATE POLICY "shipments: 관리자 전체" ON shipments
  FOR ALL USING (is_admin());

CREATE TRIGGER set_shipments_updated_at
  BEFORE UPDATE ON shipments
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
