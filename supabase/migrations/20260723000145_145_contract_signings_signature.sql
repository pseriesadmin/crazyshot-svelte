-- Migration 145: contract_signings 서명 데이터 컬럼 추가
-- 전자서명 캔버스 PNG + 스트로크 수 저장용

ALTER TABLE contract_signings
  ADD COLUMN IF NOT EXISTS signature_data TEXT,
  ADD COLUMN IF NOT EXISTS stroke_count   INTEGER;
