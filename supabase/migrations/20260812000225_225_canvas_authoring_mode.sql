-- Migration 225: canvas 기반 계약서 작성 모드 (Phase 6)
-- (파일번호 224는 별도 작업의 224_subscription_billing_rpcs.sql과 충돌해 225로 재번호)
-- contract_templates + contracts 테이블에 authoring_mode ENUM + canvas_document JSONB 추가
--
-- ⚠️ ADD-only 마이그레이션 — 기존 행은 authoring_mode='flow' 기본값 적용, canvas_document=NULL
-- ⚠️ 실DB 적용 순서: stage(ezyvffjvuwmtuhpxdjrw) 검증 → production(vnbpmvxruyciuuaermyh)
--
-- canvas_document JSON 스키마:
--   {
--     "pages": [{ "id": "uuid", "imageUrl": "...", "width": 800, "height": 1100 }],
--     "fields": [
--       {
--         "id": "uuid",
--         "pageId": "uuid",
--         "type": "signature" | "text" | "label",
--         "x": 100,  "y": 200,           -- px, page coordinate space
--         "width": 200, "height": 60,    -- px
--         "required": true,
--         "label": "서명란",
--         "boundVariable": "고객이름"    -- ContractSubstitutionData 키, type='text' 전용
--       }
--     ]
--   }

-- ── 1. ENUM 타입 신규 생성 (중복 방지) ─────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contract_authoring_mode') THEN
    CREATE TYPE contract_authoring_mode AS ENUM ('flow', 'canvas');
  END IF;
END$$;

-- ── 2. contract_templates 컬럼 추가 ─────────────────────────────────────────────
ALTER TABLE contract_templates
  ADD COLUMN IF NOT EXISTS authoring_mode contract_authoring_mode NOT NULL DEFAULT 'flow',
  ADD COLUMN IF NOT EXISTS canvas_document JSONB;

COMMENT ON COLUMN contract_templates.authoring_mode IS
  'flow: TipTap 흐름형 에디터(기본) | canvas: 고정배경 이미지 + 좌표기반 필드배치 (Phase 6)';
COMMENT ON COLUMN contract_templates.canvas_document IS
  '{ pages:[{id,imageUrl,width,height}], fields:[{id,pageId,type,x,y,width,height,required,label,boundVariable?}] }';

-- ── 3. contracts 컬럼 추가 ──────────────────────────────────────────────────────
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS authoring_mode contract_authoring_mode NOT NULL DEFAULT 'flow',
  ADD COLUMN IF NOT EXISTS canvas_document JSONB;

COMMENT ON COLUMN contracts.authoring_mode IS
  'flow: TipTap 흐름형(기본) | canvas: 고정배경+좌표기반 필드배치. 발행 시점에 확정, 이후 불변';
COMMENT ON COLUMN contracts.canvas_document IS
  'canvas 모드 전용 문서 (CanvasDocument). flow 모드면 NULL — content_blocks 사용';

-- ── 4. 인덱스 (authoring_mode 기반 필터링 지원) ─────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_contract_templates_authoring_mode
  ON contract_templates (authoring_mode);

CREATE INDEX IF NOT EXISTS idx_contracts_authoring_mode
  ON contracts (authoring_mode);

-- rollback:
-- DROP INDEX IF EXISTS idx_contracts_authoring_mode;
-- DROP INDEX IF EXISTS idx_contract_templates_authoring_mode;
-- ALTER TABLE contracts DROP COLUMN IF EXISTS canvas_document;
-- ALTER TABLE contracts DROP COLUMN IF EXISTS authoring_mode;
-- ALTER TABLE contract_templates DROP COLUMN IF EXISTS canvas_document;
-- ALTER TABLE contract_templates DROP COLUMN IF EXISTS authoring_mode;
-- DROP TYPE IF EXISTS contract_authoring_mode;
