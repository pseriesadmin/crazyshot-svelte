-- Migration #265: contract_templates / contracts 테이블에 spreadsheet_document JSONB 컬럼 추가
--
-- 배경: 전자계약 스프레드시트 모드(.xlsx → SpreadsheetDocument) 신규 구현.
--       SpreadsheetDocument(자체 스키마: sheets/rows/merges/colWidths/cellFormatting)를
--       DB에 영속화하기 위한 컬럼 추가.
--       authoring_mode = 'spreadsheet'일 때 이 컬럼에 저장 / 그 외 모드는 NULL.
--
-- ⚠️ 적용 전 반드시 crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 후 crazyshot(vnbpmvxruyciuuaermyh) 적용.
-- ⚠️ Migration #264(authoring_mode enum/check 확장)가 먼저 적용돼 있어야 함.

-- contract_templates 테이블: spreadsheet_document JSONB 컬럼 추가 (없을 때만)
ALTER TABLE contract_templates
  ADD COLUMN IF NOT EXISTS spreadsheet_document JSONB DEFAULT NULL;

-- contracts 테이블: spreadsheet_document JSONB 컬럼 추가 (없을 때만)
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS spreadsheet_document JSONB DEFAULT NULL;

-- RLS 정책은 기존 authoring_mode 컬럼과 동일한 RLS 정책을 공유하므로 별도 추가 불필요.
-- (contract_templates / contracts 테이블의 기존 RLS는 행 단위 접근 제어이며
--  컬럼별 RLS는 적용하지 않는 설계 — 이 컬럼도 동일)

-- 인덱스: authoring_mode = 'spreadsheet'인 행 조회가 빈번할 경우 아래 인덱스 추가 검토
-- (현재 데이터 규모에서는 불필요, 향후 확장 시 적용)
-- CREATE INDEX IF NOT EXISTS idx_contracts_spreadsheet
--   ON contracts(id) WHERE authoring_mode = 'spreadsheet';
