-- Migration #149: contracts 테이블에 에디터 콘텐츠 필드 추가
-- CMS에서 계약서 내용을 직접 편집할 수 있도록 확장

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS template_id    UUID REFERENCES contract_templates(id),
  ADD COLUMN IF NOT EXISTS title          TEXT,
  ADD COLUMN IF NOT EXISTS content_blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS specifications JSONB NOT NULL DEFAULT '[]'::jsonb;
