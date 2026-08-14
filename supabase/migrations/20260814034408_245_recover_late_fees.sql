-- ★ MIGRATION: 245_recover_late_fees.sql
-- Schema version: v5.55
-- Description: Support — late return fee calculation and tracking (RECOVERY)
-- Dependencies: 10_rental_reservations.sql
-- Author: Stephen Cconzy
-- Date: 2026-08-14
--
-- 복구 사유: 원본 20260529000027_27_late_fees.sql이 같은 2026-05-29 배치에서 누락됨.
-- 원본 파일은 수정하지 않고 동일 내용을 신규 파일로 적용하되, reservation_id 타입만 보정함
-- (원본 작성 시점엔 rental_reservations.id가 UUID였을 것으로 추정되나, 이후 스키마가 BIGINT로
-- 확정되어 현재 실제 컬럼과 불일치 — stage 적용 시 42804 타입불일치 에러로 확인됨).
--
-- 연체료 계산 기준 (price_rules.late_fee_per_hour):
--   hours_late = CEIL((actual_return - expected_return) / 3600)
--   fee_amount = hours_late × price_rules.late_fee_per_hour

CREATE TABLE IF NOT EXISTS late_fees (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id  BIGINT NOT NULL REFERENCES rental_reservations(id) ON DELETE RESTRICT,
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

-- ROLLBACK:
-- DROP TABLE IF EXISTS late_fees CASCADE;
