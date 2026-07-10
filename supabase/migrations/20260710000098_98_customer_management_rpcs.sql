-- Migration #98: 고객관리 CMS RPCs
-- 목적: /cms/customers 섹션에서 사용할 관리자 전용 RPC 4종
--   - get_customer_list: 회원 목록 페이지네이션 조회
--   - adjust_credit_score: 크레이지스코어 수동 조정 + 감사 로그
--   - admin_update_subscription_status: 구독 취소/일시정지 (등급 변경 금지)
--   - toggle_blacklist: 블랙리스트 등록/해제
-- 전제: Migration #97 (member_code, member_type 컬럼) 적용 완료 후 실행
-- ─────────────────────────────────────────────────────────────────────────────

-- 인덱스 (RPC 실행 성능 보장)

CREATE INDEX IF NOT EXISTS idx_user_profiles_membership_grade
  ON user_profiles(membership_grade)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_profiles_blacklisted
  ON user_profiles(blacklisted)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_credit_score_audit_user_created
  ON credit_score_audit(user_id, created_at DESC);

-- 1. get_customer_list: 회원 목록 페이지네이션

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
    up.user_id,
    up.email::TEXT,
    up.phone::TEXT,
    up.name::TEXT,
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
    COUNT(*) OVER() AS total_count
  FROM user_profiles up
  WHERE up.deleted_at IS NULL
    AND (
      p_search IS NULL OR p_search = '' OR (
        up.name  ILIKE '%' || p_search || '%'
        OR up.email ILIKE '%' || p_search || '%'
        OR up.phone ILIKE '%' || p_search || '%'
      )
    )
    AND (
      p_membership_grade IS NULL OR p_membership_grade = ''
      OR up.membership_grade::TEXT = p_membership_grade
    )
    AND (p_blacklisted IS NULL OR up.blacklisted = p_blacklisted)
  ORDER BY up.created_at DESC
  LIMIT p_limit
  OFFSET v_offset;
END;
$$;

COMMENT ON FUNCTION get_customer_list(TEXT, TEXT, BOOLEAN, INT, INT) IS
  '관리자 전용: 회원 목록 페이지네이션 조회. is_cms_user() 체크는 RLS가 담당.';

-- 2. adjust_credit_score: 크레이지스코어 수동 조정 + 감사 로그 원자적 처리

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
  -- 사용자 존재 및 스코어 조회
  SELECT credit_score INTO v_old_score
  FROM user_profiles
  WHERE user_id = p_user_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user not found');
  END IF;

  IF p_delta = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'delta cannot be zero');
  END IF;

  -- 0~100 클램프
  v_new_score := GREATEST(0, LEAST(100, v_old_score + p_delta))::SMALLINT;

  -- 스코어 업데이트
  UPDATE user_profiles
  SET credit_score = v_new_score, updated_at = NOW()
  WHERE user_id = p_user_id;

  -- 감사 로그 (원자적)
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

-- 3. admin_update_subscription_status: 구독 취소/일시정지 전용 (등급 변경 금지)

CREATE OR REPLACE FUNCTION admin_update_subscription_status(
  p_subscription_id UUID,
  p_status          TEXT,   -- 'cancelled' | 'paused' 만 허용
  p_reason          TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 등급 변경 차단: cancel/pause 만 허용
  IF p_status NOT IN ('cancelled', 'paused') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid status — only cancelled or paused allowed');
  END IF;

  UPDATE subscriptions
  SET
    status              = p_status::subscription_status,
    cancellation_reason = CASE WHEN p_status = 'cancelled' THEN p_reason ELSE cancellation_reason END,
    cancelled_at        = CASE WHEN p_status = 'cancelled' THEN NOW()    ELSE cancelled_at END,
    auto_renew          = CASE WHEN p_status = 'cancelled' THEN false     ELSE auto_renew END,
    updated_at          = NOW()
  WHERE id = p_subscription_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'subscription not found');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

COMMENT ON FUNCTION admin_update_subscription_status(UUID, TEXT, TEXT) IS
  '관리자 전용: 구독 취소(cancelled) 또는 일시정지(paused) 만 허용. 등급 변경은 사용자 직접만.';

-- 4. toggle_blacklist: 블랙리스트 등록/해제

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
  -- 블랙리스트 등록 시 사유 필수
  IF p_blacklisted = true AND (p_reason IS NULL OR trim(p_reason) = '') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reason is required when blacklisting');
  END IF;

  UPDATE user_profiles
  SET
    blacklisted      = p_blacklisted,
    blacklist_reason = CASE WHEN p_blacklisted THEN p_reason ELSE NULL END,
    updated_at       = NOW()
  WHERE user_id = p_user_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user not found');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

COMMENT ON FUNCTION toggle_blacklist(UUID, BOOLEAN, TEXT) IS
  '관리자 전용: 블랙리스트 등록(사유 필수)/해제. 해제 시 blacklist_reason 자동 NULL.';
