-- Migration 447: contract_templates / contracts 에 html_document TEXT 컬럼 추가
--
-- 전제: 446_html_authoring_mode_enum.sql 이 먼저 적용(commit)돼 있어야 함.
--
-- html_document는 "치환 완료된 최종 HTML 문자열" 하나만 저장하는 TEXT 컬럼.
-- (JSONB가 아닌 이유: content_blocks/canvas_document/spreadsheet_document 와 달리
--  저장할 구조가 단순 문자열 하나뿐이라 JSON 래핑이 불필요 — 나중에 필요해지면
--  JSONB로 마이그레이션 가능)
--
-- 적용 순서: stage(ezyvffjvuwmtuhpxdjrw) 검증 → production(vnbpmvxruyciuuaermyh) 별도 승인 후 적용

ALTER TABLE contract_templates
  ADD COLUMN IF NOT EXISTS html_document TEXT DEFAULT NULL;

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS html_document TEXT DEFAULT NULL;
