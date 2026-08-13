-- Migration 219: 발행자 서명·직인 모듈 (Phase 8-B-1)
--
-- 신규 테이블 2개:
--   1. cms_signature_assets   — 관리자가 사전 등록해두는 서명/직인 이미지 자산
--   2. contract_issuer_signatures — 개별 계약에 실제로 날인된 발행자 서명 기록
--
-- 설계 원칙:
--   - cms_signature_assets는 소프트삭제(deleted_at) — 기존 계약 참조 보존
--   - contract_issuer_signatures는 append-only (UPDATE 금지)
--   - content_hash: 날인 시점의 계약서 콘텐츠 SHA-256 (P8A-1과 동일 방식)
--   - ADD-only 마이그레이션 (기존 테이블 수정 없음)

-- ── 1. 관리자 서명/직인 자산 등록 테이블 ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS cms_signature_assets (
  id          uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_type  text        NOT NULL CHECK (asset_type IN ('signature', 'seal')),
  image_url   text        NOT NULL,           -- Supabase Storage URL
  label       text,                           -- 관리자가 구분을 위해 지정하는 이름 (예: "대표이사 서명", "법인직인")
  is_default  boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz                     -- 소프트삭제 — 기존 계약 참조 보존
);

-- 관리자별 자산 목록 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_cms_signature_assets_admin
  ON cms_signature_assets(admin_id, asset_type, deleted_at);

-- RLS: service_role만 접근 (고객 직접 조회 금지)
ALTER TABLE cms_signature_assets ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE cms_signature_assets IS
  '관리자 서명/직인 자산 사전등록 테이블 — Phase 8-B. 소프트삭제 적용.';
COMMENT ON COLUMN cms_signature_assets.asset_type IS
  'signature: 개인 서명 | seal: 법인/회사 직인';
COMMENT ON COLUMN cms_signature_assets.is_default IS
  '해당 admin_id+asset_type 조합에서 기본 선택 자산. 발행 시 자동 선택됨.';

-- ── 2. 개별 계약 발행자 서명 기록 테이블 ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS contract_issuer_signatures (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_id         uuid        NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  admin_id            uuid        NOT NULL REFERENCES auth.users(id),
  signature_type      text        NOT NULL CHECK (signature_type IN ('personal_signature', 'company_seal')),
  signature_image_url text,                   -- 저장된 이미지 URL (자산 선택 시) or 직접 서명 데이터 URL
  signature_data      text,                   -- base64 PNG (직접 서명 시). 자산 선택 시 NULL
  asset_id            uuid        REFERENCES cms_signature_assets(id),  -- 자산 선택 시 연결, 직접 서명 시 NULL
  content_hash        text,                   -- 날인 시점의 계약서 콘텐츠 SHA-256 (P8A-1 방식과 동일)
  signed_at           timestamptz NOT NULL DEFAULT now(),
  ip_address          text
);

-- 계약별 발행자 서명 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_contract_issuer_signatures_contract
  ON contract_issuer_signatures(contract_id, signed_at DESC);

-- RLS: service_role만 접근
ALTER TABLE contract_issuer_signatures ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE contract_issuer_signatures IS
  '계약별 발행자(관리자) 서명·직인 기록 — Phase 8-B. append-only.';
COMMENT ON COLUMN contract_issuer_signatures.signature_type IS
  'personal_signature: 개인 서명 | company_seal: 회사/법인 직인';
COMMENT ON COLUMN contract_issuer_signatures.asset_id IS
  'cms_signature_assets 참조. 직접 서명(SignatureCaptureCanvas) 시 NULL.';
COMMENT ON COLUMN contract_issuer_signatures.content_hash IS
  '날인 시점 계약서 콘텐츠 SHA-256 — P8A-1과 동일 방식. 날인 이후 계약서 변조 여부 검증용.';

-- ── 3. contract_templates에 발행자 서명 필수 플래그 추가 (P8B-4 전처리) ─────

ALTER TABLE contract_templates
  ADD COLUMN IF NOT EXISTS requires_issuer_signature boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN contract_templates.requires_issuer_signature IS
  'true이면 이 양식으로 발행 시 발행자 서명 없이 발송을 차단. P8B-4 강제 검증 연동.';

-- rollback:
-- ALTER TABLE contract_templates DROP COLUMN IF EXISTS requires_issuer_signature;
-- DROP TABLE IF EXISTS contract_issuer_signatures;
-- DROP INDEX IF EXISTS idx_contract_issuer_signatures_contract;
-- DROP TABLE IF EXISTS cms_signature_assets;
-- DROP INDEX IF EXISTS idx_cms_signature_assets_admin;
