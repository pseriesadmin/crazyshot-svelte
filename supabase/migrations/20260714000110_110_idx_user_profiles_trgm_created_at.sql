-- Migration 110: user_profiles trgm 인덱스 + created_at + 중복 정리
-- 근거: get_customer_list RPC가 full_name/email/phone ILIKE '%term%' 패턴 사용.
--       30,000 계정에서 full table scan → 선형 악화. trgm GIN으로 즉시 해결.
-- NOTE: stage DB에 pg_trgm 미활성화 상태 → Extension 먼저 활성화
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. 고객 검색 ILIKE full table scan 제거
CREATE INDEX IF NOT EXISTS idx_user_profiles_name_trgm
  ON user_profiles USING GIN (full_name gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_profiles_email_trgm
  ON user_profiles USING GIN (email gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_profiles_phone_trgm
  ON user_profiles USING GIN (phone gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- 2. 고객 목록 정렬 인덱스 (get_customer_list ORDER BY created_at DESC, 현재 없음)
CREATE INDEX IF NOT EXISTS idx_user_profiles_created_at
  ON user_profiles(created_at DESC)
  WHERE deleted_at IS NULL;

-- 3. 중복 인덱스 제거 (Migration 03 idx_user_profiles_grade와 Migration 98
--    idx_user_profiles_membership_grade가 동일 컬럼 중복. 03의 것을 제거)
DROP INDEX IF EXISTS idx_user_profiles_grade;

-- ※ idx_user_profiles_user_id (비조건부 전체 인덱스)는 삭제 금지
--    이유: idx_user_profiles_active는 WHERE deleted_at IS NULL 부분 인덱스.
--          deleted_at 조건 없는 쿼리에서는 비조건부 인덱스가 필요.
--          두 인덱스 서로 다른 쿼리 패턴 담당 → 양립 유지.
