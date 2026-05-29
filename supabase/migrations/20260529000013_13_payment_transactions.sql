-- ★ MIGRATION: 13_payment_transactions.sql
-- Schema version: v5.46
-- Description: M3 Orders — TossPayments v2 payment transactions with idempotency
-- Dependencies: 11_orders.sql, 02_enums.sql
-- Author: Stephen Cconzy
-- Date: 2026-05-29
--
-- TossPayments v2 연동:
--   - idempotency_key UNIQUE: 중복 결제 방지
--   - is_deposit: 보증금 선수금 여부
--   - provider_response: TossPayments 원문 응답 보관 (JSONB)

CREATE TABLE IF NOT EXISTS payment_transactions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  payment_key          VARCHAR(200) NOT NULL,   -- TossPayments paymentKey
  idempotency_key      VARCHAR(200) NOT NULL UNIQUE,  -- 멱등성 키
  amount               NUMERIC(12,2) NOT NULL CHECK(amount > 0),
  status               payment_status_enum NOT NULL DEFAULT 'pending',
  payment_method       VARCHAR(30) NOT NULL
                         CHECK(payment_method IN ('card', 'bank_transfer', 'virtual_account')),
  is_deposit           BOOLEAN NOT NULL DEFAULT false,   -- 보증금(선수금) 여부
  deposit_hold_id      UUID,                             -- FK deposit_holds.id (후 마이그레이션에서 FK 추가)
  provider_response    JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_transactions_order_id   ON payment_transactions(order_id);
CREATE INDEX idx_payment_transactions_status     ON payment_transactions(status);
CREATE INDEX idx_payment_transactions_payment_key ON payment_transactions(payment_key);

ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_transactions: 본인 조회" ON payment_transactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = payment_transactions.order_id
        AND o.user_id = auth.uid()
    )
  );

CREATE POLICY "payment_transactions: 관리자 전체" ON payment_transactions
  FOR ALL USING (is_admin());

CREATE TRIGGER set_payment_transactions_updated_at
  BEFORE UPDATE ON payment_transactions
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
