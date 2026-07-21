-- Migration #128: products 테이블 구성품 컬럼 추가
-- 목적: 상품별 구성품 목록을 독립 JSONB 컬럼으로 저장
--       기존 specifications(기술스펙)과 별도 관리
-- 저장 형태: {"배터리": "1개", "충전기": "단일"}
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS components JSONB;

COMMENT ON COLUMN products.components IS
  '구성품 목록: {"배터리": "1개", "충전기": "단일"} 형태 JSONB';
