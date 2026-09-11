-- Migration 489: legacy_member_staging 테이블 신설 — CSV 임포트 데이터를 실 계정(auth.users/
-- user_profiles)과 완전히 격리된 별도 테이블에만 저장한다.
--
-- 배경(2026-09-11, Stephen 지적 — 개인정보보호법 위반 소지 시정): 기존 설계(Migration
-- 483~486)는 CSV 업로드 즉시 admin.auth.admin.createUser() + user_profiles UPDATE로 실제
-- 고객 DB에 편입시켰다 — 본인이 아무 행동도 하기 전에 이전 시스템 CSV의 개인정보(이름·
-- 전화번호·이메일)가 실 고객 DB에 그대로 들어가고 CMS 고객목록에도 즉시 노출되는 구조였다.
-- 이 마이그레이션은 그 설계를 폐기하고, CSV는 이 격리 테이블에만 적재하며, 실제 계정 생성은
-- 본인이 이름+전화번호 인증(OTP)을 실제로 완료하는 시점(/api/auth/legacy-claim/complete)
-- 으로 이동시킨다(Migration 490이 find_legacy_member를 이 테이블 대상으로 재정의).
--
-- RLS 패턴은 legacy_claim_otps(Migration 484)와 동일 — service_role 전용, 클라이언트
-- 직접 접근 완전 차단.

CREATE TABLE IF NOT EXISTS legacy_member_staging (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name              TEXT        NOT NULL,
  phone                  TEXT,                    -- 정규화된 010######## 형식. EC-3(전화번호 없는
                                                    -- CSV 행) 허용 — 그 경우 클레임 매칭 대상이
                                                    -- 될 수 없어 사실상 미사용 상태로 남는다.
  email                  TEXT        NOT NULL,     -- 클레임 성공 시 auth.users.email이 됨
  legacy_source          TEXT,                     -- 'kakao' | 'naver' | 'csv'
  legacy_signup_at       TIMESTAMPTZ,
  legacy_purchase_count  INTEGER     NOT NULL DEFAULT 0,
  imported_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at             TIMESTAMPTZ,              -- 정상 흐름에서는 사용되지 않는다(클레임 성공 시
                                                    -- 행 자체가 DELETE되므로) — 부분 실패 복구
                                                    -- 시나리오 대비 방어용 컬럼
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE legacy_member_staging ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_only_legacy_member_staging" ON legacy_member_staging;
CREATE POLICY "service_role_only_legacy_member_staging" ON legacy_member_staging
  FOR ALL USING (false);  -- service_role만 접근 가능 (legacy_claim_otps와 동일 패턴)

CREATE INDEX IF NOT EXISTS idx_legacy_member_staging_phone_unclaimed
  ON legacy_member_staging(phone)
  WHERE claimed_at IS NULL;

-- 동일 이메일 중복 스테이징 방지(재임포트 시 앱 레벨 체크의 안전망)
CREATE UNIQUE INDEX IF NOT EXISTS idx_legacy_member_staging_email_unique
  ON legacy_member_staging(email);

COMMENT ON TABLE legacy_member_staging IS
  'CSV 일괄 임포트된 레거시 회원 후보 데이터. auth.users/user_profiles와 완전히 격리됨.
   본인이 OTP 인증(complete)을 완료해야만 실 계정으로 승격되고, 승격 즉시 이 행은 DELETE된다
   (개인정보 최소보유 원칙 — 익명화 보존이 아니라 완전 삭제).';
