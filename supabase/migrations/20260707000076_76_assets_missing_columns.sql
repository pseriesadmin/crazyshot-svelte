-- Migration #76: assets 테이블 누락 컬럼 추가
-- 목적: 일부 DB 환경에서 05_assets.sql 원본과 스키마 불일치 발생
--       condition_notes / warehouse_location 컬럼 누락 보정

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS condition_notes text,
  ADD COLUMN IF NOT EXISTS warehouse_location varchar(100);
