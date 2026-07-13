-- Migration #98 v2: 고객관리 CMS 기반 스키마 + RPC 4종
-- 목적: /cms/customers 섹션 구동에 필요한 스키마 + 관리자 RPC 4종
--   1. user_profiles 고객관리 컬럼 추가 (ADD COLUMN IF NOT EXISTS)
--   2. credit_score_audit 테이블 신설
--   3. get_customer_list / adjust_credit_score / admin_update_subscription_status / toggle_blacklist
-- 실제 DB 기반: user_profiles.id(PK), full_name, user_subscriptions 테이블
-- 프런트 호환: id→user_id alias, full_name→name alias 로 반환
-- 전제: Migration #97 (member_code, member_type) 적용 완료
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. user_profiles 고객관리 컬럼 추가

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS membership_grade TEXT
    NOT NULL DEFAULT 'NONE'
    CHECK (membership_grade IN ('NONE', 'EASY', 'POP', 'CRAZY')),
  ADD COLUMN IF NOT EXISTS credit_score SMALLINT
    NOT NULL DEFAULT 70
    CHECK (credit_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS rental_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_return_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS damage_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS points INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blacklisted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blacklist_reason TEXT,
  ADD COLUMN IF NOT EXISTS is_foreign BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN user_profiles.membership_grade IS 'NONE/EASY/POP/CRAZY 멤버십 등급';
COMMENT ON COLUMN user_profiles.credit_score IS '크레이지스코어 0~100, 기본 70';
COMMENT ON COLUMN user_profiles.rental_count IS '총 대여 횟수';
COMMENT ON COLUMN user_profiles.late_return_count IS '연체 반납 횟수';
COMMENT ON COLUMN user_profiles.damage_count IS '파손 건수';
COMMENT ON COLUMN user_profiles.points IS '보유 포인트';
COMMENT ON COLUMN user_profiles.blacklisted IS '블랙리스트 여부';
COMMENT ON COLUMN user_profiles.blacklist_reason IS '블랙리스트 사유';
COMMENT ON COLUMN user_profiles.is_foreign IS '외국인 여부';
COMMENT ON COLUMN user_profiles.deleted_at IS 'Soft delete 타임스탬프';

-- 2. credit_score_audit 테이블 신설

CREATE TABLE IF NOT EXISTS credit_score_audit (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  old_score   SMALLINT    NOT NULL,
  new_score   SMALLINT    NOT NULL,
  reason      TEXT        NOT NULL,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE credit_score_audit IS
  '크레이지스코어 조정 이력 — 수동/자동 조정 모두 기록';

-- 3. 인덱스

CREATE INDEX IF NOT EXISTS idx_user_profiles_membership_grade
  ON user_profiles(membership_grade)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_profiles_blacklisted
  ON user_profiles(blacklisted)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_credit_score_audit_user_created
  ON credit_score_audit(user_id, created_at DESC);

-- 4. get_customer_list
-- id → user_id 별칭, full_name → name 별칭 반환 (프런트엔드 인터페이스 호환)

CREATE OR REPLACE FUNCTION get_customer_list(
  p_search           TEXT    DEFAULT NULL,
  p_membership_grade TEXT    DEFAULT NULL,
  p_blacklisted      BOOLEAN DEFAULT NULL,
  p_page             INT     DEFAULT 1,
  p_limit            INT     DEFAULT 50
)
RETURNS TABLE (
  user_id            UUID,
  email              TEXT,
  phone              TEXT,
  name               TEXT,
  member_code        TEXT,
  member_type        TEXT,
  membership_grade   TEXT,
  credit_score       SMALLINT,
  rental_count       INT,
  late_return_count  INT,
  damage_count       INT,
  points             INT,
  blacklisted        BOOLEAN,
  blacklist_reason   TEXT,
  is_student         BOOLEAN,
  is_foreign         BOOLEAN,
  created_at         TIMESTAMPTZ,
  total_count        BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset INT := (p_page - 1) * p_limit;
BEGIN
  RETURN QUERY
  SELECT
    up.id                  AS user_id,
    up.email::TEXT,
    up.phone::TEXT,
    up.full_name::TEXT     AS name,
    up.member_code::TEXT,
    up.member_type::TEXT,
    up.membership_grade::TEXT,
    up.credit_score,
    up.rental_count,
    up.late_return_count,
    up.damage_count,
    up.points,
    up.blacklisted,
    up.blacklist_reason::TEXT,
    up.is_student,
    up.is_foreign,
    up.created_at,
    COUNT(*) OVER()        AS total_count
  FROM user_profiles up
  WHERE up.deleted_at IS NULL
    AND (
      p_search IS NULL OR p_search = '' OR (
        up.full_name ILIKE '%' || p_search || '%'
        OR up.email  ILIKE '%' || p_search || '%'
        OR up.phone  ILIKE '%' || p_search || '%'
      )
    )
    AND (
      p_membership_grade IS NULL OR p_membership_grade = ''
      OR up.membership_grade = p_membership_grade
    )
    AND (p_blacklisted IS NULL OR up.blacklisted = p_blacklisted)
  ORDER BY up.created_at DESC
  LIMIT p_limit
  OFFSET v_offset;
END;
$$;

COMMENT ON FUNCTION get_customer_list(TEXT, TEXT, BOOLEAN, INT, INT) IS
  '관리자 전용: 회원 목록 페이지네이션. id→user_id, full_name→name 별칭으로 반환.';

-- 5. adjust_credit_score
-- p_user_id = user_profiles.id

CREATE OR REPLACE FUNCTION adjust_credit_score(
  p_user_id UUID,
  p_delta   INT,
  p_reason  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_score SMALLINT;
  v_new_score SMALLINT;
BEGIN
  SELECT credit_score INTO v_old_score
  FROM user_profiles
  WHERE id = p_user_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user not found');
  END IF;

  IF p_delta = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'delta cannot be zero');
  END IF;

  v_new_score := GREATEST(0, LEAST(100, v_old_score + p_delta))::SMALLINT;

  UPDATE user_profiles
  SET credit_score = v_new_score, updated_at = NOW()
  WHERE id = p_user_id;

  INSERT INTO credit_score_audit(user_id, old_score, new_score, reason, metadata)
  VALUES (
    p_user_id,
    v_old_score,
    v_new_score,
    p_reason,
    jsonb_build_object('source', 'admin_manual', 'delta', p_delta)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'old_score', v_old_score,
    'new_score', v_new_score
  );
END;
$$;

COMMENT ON FUNCTION adjust_credit_score(UUID, INT, TEXT) IS
  '관리자 전용: 크레이지스코어 수동 조정. 0~100 클램프 + credit_score_audit 원자적 INSERT.';

-- 6. admin_update_subscription_status
-- user_subscriptions 테이블 사용 (id: BIGINT)
-- 컬럼: id(bigint), user_id, plan_id, status(text), started_at, expires_at, cancelled_at, updated_at

CREATE OR REPLACE FUNCTION admin_update_subscription_status(
  p_subscription_id BIGINT,
  p_status          TEXT,
  p_reason          TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('cancelled', 'paused') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid status — only cancelled or paused allowed');
  END IF;

  UPDATE user_subscriptions
  SET
    status       = p_status,
    cancelled_at = CASE WHEN p_status = 'cancelled' THEN NOW() ELSE cancelled_at END,
    updated_at   = NOW()
  WHERE id = p_subscription_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'subscription not found');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

COMMENT ON FUNCTION admin_update_subscription_status(BIGINT, TEXT, TEXT) IS
  '관리자 전용: user_subscriptions 취소(cancelled)/일시정지(paused). 등급 변경은 사용자 직접만.';

-- 7. toggle_blacklist
-- p_user_id = user_profiles.id

CREATE OR REPLACE FUNCTION toggle_blacklist(
  p_user_id     UUID,
  p_blacklisted BOOLEAN,
  p_reason      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_blacklisted = true AND (p_reason IS NULL OR trim(p_reason) = '') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reason is required when blacklisting');
  END IF;

  UPDATE user_profiles
  SET
    blacklisted      = p_blacklisted,
    blacklist_reason = CASE WHEN p_blacklisted THEN p_reason ELSE NULL END,
    updated_at       = NOW()
  WHERE id = p_user_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user not found');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

COMMENT ON FUNCTION toggle_blacklist(UUID, BOOLEAN, TEXT) IS
  '관리자 전용: 블랙리스트 등록(사유 필수)/해제. 해제 시 blacklist_reason 자동 NULL.';
