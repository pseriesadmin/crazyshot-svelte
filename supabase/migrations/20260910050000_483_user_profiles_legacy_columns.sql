-- Migration 483: user_profiles에 레거시 회원 컬럼 4종 추가
-- 목적: 과거 SNS 로그인(카카오/네이버) 기반 서비스 회원 CSV 데이터를 선등록 계정으로 관리하기 위한 메타 컬럼

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS legacy_source        TEXT,         -- 'kakao' | 'naver' | 'csv' 등 원출처
  ADD COLUMN IF NOT EXISTS legacy_imported_at   TIMESTAMPTZ,  -- CMS에서 일괄 등록된 시각
  ADD COLUMN IF NOT EXISTS legacy_signup_at     TIMESTAMPTZ,  -- 원 서비스 가입 일자 (CSV에서 가져온 값)
  ADD COLUMN IF NOT EXISTS legacy_purchase_count INTEGER DEFAULT 0;  -- 원 서비스 구매횟수 (CSV 값, rental_count와 무관)

-- 인덱스: 레거시 미인증 계정 조회 최적화 (legacy-import 화면 + find_legacy_member RPC)
CREATE INDEX IF NOT EXISTS idx_user_profiles_legacy_imported
  ON user_profiles(legacy_imported_at)
  WHERE legacy_imported_at IS NOT NULL;

COMMENT ON COLUMN user_profiles.legacy_source IS '레거시 계정 원출처 (kakao, naver, csv 등). 비레거시 계정은 NULL.';
COMMENT ON COLUMN user_profiles.legacy_imported_at IS 'CMS에서 레거시 CSV 일괄 등록 시각. 인증 클레임 흐름 게이팅에 사용.';
COMMENT ON COLUMN user_profiles.legacy_signup_at IS '원 서비스(구 크레이지샷)의 가입 일자. 고객 확인 화면 Step4에 표시.';
COMMENT ON COLUMN user_profiles.legacy_purchase_count IS '원 서비스 구매횟수(CSV 원본). rental_count와 완전히 별개 — 혼용 금지.';
