-- Migration #72: assets 테이블 장치코드 필드 추가
-- 목적: 모바일 CMS 장치정보 탭 — asset_code / deleted_at 누락 컬럼 추가

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS asset_code text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- 인덱스: deleted_at 소프트 삭제 필터용
CREATE INDEX IF NOT EXISTS idx_assets_deleted_at ON assets (deleted_at)
  WHERE deleted_at IS NULL;
