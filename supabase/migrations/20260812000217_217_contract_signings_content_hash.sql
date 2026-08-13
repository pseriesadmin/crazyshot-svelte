-- Migration 217: contract_signings.content_hash 컬럼 추가
-- Phase 8-A-1: 서명 제출 시점 SHA-256 콘텐츠 해시 바인딩
--
-- 목적: 서명 당시 실제로 어떤 콘텐츠에 서명했는가를 암호학적으로 증명.
--       서버가 content_blocks(또는 canvas_document)를 SHA-256으로 해시해 저장.
--       이후 계약서 내용이 사후에 변조됐는지 검증 가능.
--
-- ⚠️ ADD-only 마이그레이션 — 기존 contract_signings 행은 content_hash = NULL로 유지.
--    이전 서명 레코드는 이 컬럼이 없던 시점의 서명으로, 소급 적용하지 않는다.

ALTER TABLE contract_signings
  ADD COLUMN IF NOT EXISTS content_hash text;

COMMENT ON COLUMN contract_signings.content_hash IS
  'SHA-256 hex(64자) — 서명 제출 시점의 계약서 콘텐츠(content_blocks 또는 canvas_document) 해시. NULL이면 Phase 8-A 이전 서명.';

-- rollback:
-- ALTER TABLE contract_signings DROP COLUMN IF EXISTS content_hash;
