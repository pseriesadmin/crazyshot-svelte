-- Migration 484: legacy_claim_otps 테이블 + find_legacy_member RPC
-- 목적: 레거시 회원 인증 클레임 흐름 — OTP 저장 + 계정 매칭 RPC

-- ─────────────────────────────────────────────────
-- 1. legacy_claim_otps 테이블
--    phone_otps와 다른 점: user_id 불필요 (인증 전 상태에서 사용)
-- ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS legacy_claim_otps (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         TEXT        NOT NULL,          -- 정규화된 10~11자리 숫자
  code          TEXT        NOT NULL,          -- 6자리 숫자 코드
  attempt_count SMALLINT    NOT NULL DEFAULT 0, -- 시도 횟수 (5회 초과 시 만료 처리)
  expires_at    TIMESTAMPTZ NOT NULL,           -- OTP 만료 시각 (생성 후 5분)
  verified_at   TIMESTAMPTZ,                   -- 검증 완료 시각 (NULL = 미검증)
  claimed_at    TIMESTAMPTZ,                   -- complete 완료 시각
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE legacy_claim_otps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_only_legacy_claim_otps" ON legacy_claim_otps;
CREATE POLICY "service_role_only_legacy_claim_otps" ON legacy_claim_otps
  FOR ALL USING (false);  -- service_role만 접근 가능

CREATE INDEX IF NOT EXISTS idx_legacy_claim_otps_phone_expires
  ON legacy_claim_otps(phone, expires_at)
  WHERE verified_at IS NULL AND claimed_at IS NULL;

-- ─────────────────────────────────────────────────
-- 2. find_legacy_member RPC
--    이름 + 전화번호로 레거시 계정 매칭
--    - legacy_imported_at IS NOT NULL (레거시 계정)
--    - auth.users.encrypted_password IS NULL 또는 '' (아직 클레임 안 됨)
--    - service_role 전용 (클라이언트 직접 호출 차단)
-- ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION find_legacy_member(
  p_name  TEXT,
  p_phone TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_up  user_profiles%ROWTYPE;
  v_enc TEXT;
BEGIN
  -- 이름 + 전화번호로 레거시 계정 조회
  SELECT up.*
  INTO   v_up
  FROM   public.user_profiles up
  WHERE  up.name                    = p_name
    AND  up.phone                   = p_phone
    AND  up.legacy_imported_at      IS NOT NULL
    AND  up.deleted_at              IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- auth.users.encrypted_password 조회 — 이미 클레임 완료된 계정 제외
  SELECT au.encrypted_password
  INTO   v_enc
  FROM   auth.users au
  WHERE  au.id = v_up.user_id;

  -- 이미 비밀번호가 설정된 계정은 매칭 실패로 취급 (EC-2)
  IF v_enc IS NOT NULL AND v_enc <> '' THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'user_id',               v_up.user_id::text,
    'email',                 v_up.email,
    'name',                  v_up.name,
    'phone',                 v_up.phone,
    'membership_grade',      v_up.membership_grade::text,
    'legacy_signup_at',      v_up.legacy_signup_at,
    'legacy_purchase_count', v_up.legacy_purchase_count,
    'points',                v_up.points
  );
END;
$$;

-- service_role 전용: 클라이언트(anon/authenticated) 직접 호출 차단
REVOKE ALL ON FUNCTION find_legacy_member(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION find_legacy_member(TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION find_legacy_member(TEXT, TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION find_legacy_member(TEXT, TEXT) TO service_role;
