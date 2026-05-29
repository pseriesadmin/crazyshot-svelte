-- ★ MIGRATION: 18_credit_score_audit.sql
-- Schema version: v5.46
-- Description: M4 Membership — credit score change audit log (불변 감사 로그)
-- Dependencies: 03_user_profiles.sql
-- Author: Stephen Cconzy
-- Date: 2026-05-29
--
-- credit_score 변경 사유 (§13):
--   정시 반납: +5
--   연체 반납: -10
--   손상 보고: -20
--   장기 우량: +3 (월간 pg_cron)

CREATE TABLE IF NOT EXISTS credit_score_audit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  old_score   SMALLINT NOT NULL CHECK(old_score BETWEEN 0 AND 100),
  new_score   SMALLINT NOT NULL CHECK(new_score BETWEEN 0 AND 100),
  reason      VARCHAR(200) NOT NULL,
  metadata    JSONB,    -- reservation_id, order_id 등 관련 컨텍스트
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- ★ 수정/삭제 불가 (UPDATE, DELETE 없음) — 감사 로그는 불변
);

CREATE INDEX idx_credit_score_audit_user_id    ON credit_score_audit(user_id);
CREATE INDEX idx_credit_score_audit_created_at ON credit_score_audit(created_at DESC);

ALTER TABLE credit_score_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "credit_score_audit: 본인 조회" ON credit_score_audit
  FOR SELECT USING (user_id = auth.uid());

-- INSERT 허용 없음 — RPC를 통해서만 기록
CREATE POLICY "credit_score_audit: 관리자 전체" ON credit_score_audit
  FOR ALL USING (is_admin());
