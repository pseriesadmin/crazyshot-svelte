-- ★ MIGRATION: 21_contracts.sql
-- Schema version: v5.46
-- Description: M5 Contracts — electronic rental/subscription contracts
-- Dependencies: 11_orders.sql, 02_enums.sql
-- Author: Stephen Cconzy
-- Date: 2026-05-29

CREATE TABLE IF NOT EXISTS contracts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  contract_type       VARCHAR(20) NOT NULL CHECK(contract_type IN ('rental', 'subscription')),
  status              contract_status_enum NOT NULL DEFAULT 'active',
  document_url        TEXT NOT NULL,
  signed_at           TIMESTAMPTZ,
  terms_accepted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_contracts_order_id ON contracts(order_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_contracts_user_id  ON contracts(user_id)  WHERE deleted_at IS NULL;
CREATE INDEX idx_contracts_status   ON contracts(status)   WHERE deleted_at IS NULL;

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contracts: 본인 조회" ON contracts
  FOR SELECT USING (user_id = auth.uid() AND deleted_at IS NULL);

CREATE POLICY "contracts: 관리자 전체" ON contracts
  FOR ALL USING (is_admin());

CREATE TRIGGER set_contracts_updated_at
  BEFORE UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
