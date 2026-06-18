-- ★ MIGRATION: 27_late_fees.sql
-- Schema version: v5.46
-- Description: Support — late return fee calculation and tracking
-- Dependencies: 10_rental_reservations.sql
-- Author: Stephen Cconzy
-- Date: 2026-05-29
--
-- 연체료 계산 기준 (price_rules.late_fee_per_hour):
--   hours_late = CEIL((actual_return - expected_return) / 3600)
--   fee_amount = hours_late × price_rules.late_fee_per_hour

CREATE TABLE IF NOT EXISTS late_fees (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id  UUID NOT NULL REFERENCES rental_reservations(id) ON DELETE RESTRICT,
  hours_late      INT NOT NULL CHECK(hours_late > 0),
  fee_amount      NUMERIC(10,2) NOT NULL CHECK(fee_amount > 0),
  is_paid         BOOLEAN NOT NULL DEFAULT false,
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(reservation_id)  -- 예약당 연체료 기록은 1건
);

CREATE INDEX idx_late_fees_reservation_id ON late_fees(reservation_id);
CREATE INDEX idx_late_fees_is_paid        ON late_fees(is_paid) WHERE is_paid = false;

ALTER TABLE late_fees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "late_fees: 본인 조회" ON late_fees
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM rental_reservations rr
      WHERE rr.id = late_fees.reservation_id
        AND rr.user_id = auth.uid()
    )
  );

CREATE POLICY "late_fees: 관리자 전체" ON late_fees
  FOR ALL USING (is_admin());

CREATE TRIGGER set_late_fees_updated_at
  BEFORE UPDATE ON late_fees
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
