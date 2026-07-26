-- Migration #148: contract_templates 테이블 신규
-- 계약서 양식 템플릿 — 관리자가 만드는 재사용 가능한 계약서 마스터

CREATE TABLE IF NOT EXISTS contract_templates (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT        NOT NULL,
  content_blocks  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  specifications  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  status          TEXT        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'archived')),
  created_by      UUID        REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_contract_templates_status
  ON contract_templates(status)
  WHERE deleted_at IS NULL;

ALTER TABLE contract_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cms_only" ON contract_templates
  USING (auth.jwt() ->> 'role' = 'service_role');
