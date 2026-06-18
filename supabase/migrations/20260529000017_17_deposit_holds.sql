-- ★ MIGRATION: 17_deposit_holds.sql
-- Schema version: v5.46
-- Description: M4 Membership — deposit pre-authorization holds (보증금 선수금)
-- Dependencies: 02_enums.sql
-- Author: Stephen Cconzy
-- Date: 2026-05-29
--
-- credit_score 기반 보증금 정책 (§13):
--   70~100 점: 표준 보증금
--   50~69 점: 1.5× 보증금
--   0~49  점: 2× 보증금 (또는 렌탈 거부)
--
-- TossPayments 선수금(preAuth) 연동 전제

CREATE TABLE IF NOT EXISTS deposit_holds (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  amount                   NUMERIC(12,2) NOT NULL CHECK(amount > 0),
  reason                   TEXT NOT NULL,
  payment_transaction_id   UUID,  -- FK payment_transactions.id (후 FK 추가 가능)
  is_released              BOOLEAN NOT NULL DEFAULT false,
  released_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deposit_holds_user_id    ON deposit_holds(user_id);
CREATE INDEX idx_deposit_holds_released   ON deposit_holds(is_released) WHERE is_released = false;

ALTER TABLE deposit_holds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deposit_holds: 본인 조회" ON deposit_holds
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "deposit_holds: 관리자 전체" ON deposit_holds
  FOR ALL USING (is_admin());

CREATE TRIGGER set_deposit_holds_updated_at
  BEFORE UPDATE ON deposit_holds
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- 결제 트랜잭션과 FK 연결 (13번 migration 이후이므로 여기서 추가)
ALTER TABLE payment_transactions
  ADD CONSTRAINT fk_payment_transactions_deposit_hold
  FOREIGN KEY (deposit_hold_id) REFERENCES deposit_holds(id) ON DELETE SET NULL;
