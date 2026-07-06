-- Migration #51: 프로모션 RPC v2 — 쿠폰·포인트 확장 RPC 함수
-- Phase 1 보강: 통계 확장 + 배포 + 기간연장 + 일괄발행 + 적립규칙 업데이트
-- 2026-07-03

-- ─────────────────────────────────────────────────────────
-- 1. get_coupon_stats — total_discount_amount + conversion_rate 추가
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_coupon_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  SELECT jsonb_build_object(
    'total_issued',          COUNT(*)                                           FILTER (WHERE uc.id IS NOT NULL),
    'total_active',          COUNT(*)                                           FILTER (WHERE c.is_active AND (c.valid_until IS NULL OR c.valid_until > now())),
    'total_used',            COALESCE(SUM(c.usage_count), 0),
    'total_expired',         COUNT(*)                                           FILTER (WHERE c.valid_until IS NOT NULL AND c.valid_until <= now()),
    'total_discount_amount', COALESCE(
      (SELECT SUM(
         CASE
           WHEN c2.discount_type = 'percent' THEN 0  -- 실제 할인액 집계 미구현 (결제 통합 후 연동)
           WHEN c2.discount_type = 'fixed'   THEN c2.discount_value * c2.usage_count
           ELSE 0
         END
       ) FROM coupons c2 WHERE c2.deleted_at IS NULL
      ), 0
    ),
    'conversion_rate', CASE
      WHEN COUNT(*) FILTER (WHERE uc.id IS NOT NULL) = 0 THEN 0
      ELSE ROUND(
        (COALESCE(SUM(c.usage_count), 0)::NUMERIC
          / NULLIF(COUNT(*) FILTER (WHERE uc.id IS NOT NULL), 0)) * 100, 1
      )
    END
  )
  INTO v_result
  FROM coupons c
  LEFT JOIN user_coupons uc ON uc.coupon_id = c.id
  WHERE c.deleted_at IS NULL;

  RETURN v_result;
END;
$$;

-- ─────────────────────────────────────────────────────────
-- 2. get_coupon_usage_report — 기존 함수 개선 (확장 컬럼)
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_coupon_usage_report(
  p_period TEXT DEFAULT 'day',   -- 'day' | 'month' | 'year'
  p_from   TIMESTAMPTZ DEFAULT NULL,
  p_to     TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  period        TEXT,
  coupon_id     UUID,
  coupon_code   TEXT,
  coupon_type   TEXT,
  issued_count  BIGINT,
  used_count    BIGINT,
  conversion_pct NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  RETURN QUERY
  SELECT
    CASE p_period
      WHEN 'month' THEN to_char(uc.used_at, 'YYYY-MM')
      WHEN 'year'  THEN to_char(uc.used_at, 'YYYY')
      ELSE              to_char(uc.used_at, 'YYYY-MM-DD')
    END AS period,
    c.id                                        AS coupon_id,
    c.code                                      AS coupon_code,
    c.type::TEXT                                AS coupon_type,
    COUNT(uc.id)                                AS issued_count,
    COUNT(uc.id) FILTER (WHERE uc.used_at IS NOT NULL) AS used_count,
    ROUND(
      COUNT(uc.id) FILTER (WHERE uc.used_at IS NOT NULL)::NUMERIC
        / NULLIF(COUNT(uc.id), 0) * 100, 1
    )                                           AS conversion_pct
  FROM user_coupons uc
  JOIN coupons c ON c.id = uc.coupon_id
  WHERE c.deleted_at IS NULL
    AND (p_from IS NULL OR uc.created_at >= p_from)
    AND (p_to   IS NULL OR uc.created_at <= p_to)
  GROUP BY period, c.id, c.code, c.type
  ORDER BY period DESC, used_count DESC;
END;
$$;

-- ─────────────────────────────────────────────────────────
-- 3. distribute_coupon — 쿠폰 배포 (user_coupons 일괄 INSERT)
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.distribute_coupon(
  p_coupon_id   UUID,
  p_target_type TEXT,    -- 'all' | 'grade' | 'specific_user'
  p_target_meta JSONB DEFAULT NULL,
  p_admin_id    UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_coupon       RECORD;
  v_users        UUID[];
  v_issued_count INT := 0;
  v_dist_id      UUID;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  SELECT * INTO v_coupon FROM coupons WHERE id = p_coupon_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COUPON_NOT_FOUND');
  END IF;

  -- 대상 사용자 수집
  IF p_target_type = 'all' THEN
    SELECT ARRAY_AGG(id) INTO v_users FROM auth.users;

  ELSIF p_target_type = 'grade' THEN
    SELECT ARRAY_AGG(id) INTO v_users
    FROM user_profiles
    WHERE membership_grade = (p_target_meta->>'grade');

  ELSIF p_target_type = 'specific_user' THEN
    SELECT ARRAY_AGG(val::UUID) INTO v_users
    FROM jsonb_array_elements_text(p_target_meta->'user_ids') AS val;

  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TARGET_TYPE');
  END IF;

  -- user_coupons INSERT (중복 스킵)
  INSERT INTO user_coupons (user_id, coupon_id, issued_at)
  SELECT uid, p_coupon_id, now()
  FROM UNNEST(v_users) AS uid
  ON CONFLICT (user_id, coupon_id) DO NOTHING;

  GET DIAGNOSTICS v_issued_count = ROW_COUNT;

  -- 배포 이력 기록
  INSERT INTO coupon_distributions (coupon_id, admin_id, target_type, target_meta, issued_count)
  VALUES (p_coupon_id, COALESCE(p_admin_id, auth.uid()), p_target_type, p_target_meta, v_issued_count)
  RETURNING id INTO v_dist_id;

  RETURN jsonb_build_object('ok', true, 'issued_count', v_issued_count, 'distribution_id', v_dist_id);
END;
$$;

-- ─────────────────────────────────────────────────────────
-- 4. extend_coupon — 쿠폰 유효기간 연장
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.extend_coupon(
  p_coupon_id UUID,
  p_new_until TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  UPDATE coupons
  SET valid_until = p_new_until,
      updated_at  = now()
  WHERE id = p_coupon_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COUPON_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ─────────────────────────────────────────────────────────
-- 5. get_point_stats — 확장 (usage_rate / avg_user_balance / monthly_issued / expiring_30d)
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_point_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  SELECT jsonb_build_object(
    'total_granted',    COALESCE(SUM(amount) FILTER (WHERE type IN ('earn','admin_grant')), 0),
    'total_used',       ABS(COALESCE(SUM(amount) FILTER (WHERE type IN ('use','admin_deduct')), 0)),
    'total_expired',    ABS(COALESCE(SUM(amount) FILTER (WHERE type = 'expire'), 0)),
    'total_balance',    COALESCE((SELECT SUM(points) FROM user_profiles WHERE points > 0), 0),
    'usage_rate',       CASE
      WHEN COALESCE(SUM(amount) FILTER (WHERE type IN ('earn','admin_grant')), 0) = 0 THEN 0
      ELSE ROUND(
        ABS(COALESCE(SUM(amount) FILTER (WHERE type IN ('use','admin_deduct')), 0))::NUMERIC
          / NULLIF(COALESCE(SUM(amount) FILTER (WHERE type IN ('earn','admin_grant')), 0), 0) * 100, 1
      )
    END,
    'avg_user_balance', COALESCE(
      (SELECT ROUND(AVG(points), 0) FROM user_profiles WHERE points > 0), 0
    ),
    'monthly_issued',   COALESCE(
      SUM(amount) FILTER (
        WHERE type IN ('earn','admin_grant')
          AND created_at >= date_trunc('month', now())
      ), 0
    ),
    'expiring_30d',     0  -- 활동 기반 만료 — 별도 집계 함수로 계산 (추후 구현)
  )
  INTO v_result
  FROM point_transactions;

  RETURN v_result;
END;
$$;

-- ─────────────────────────────────────────────────────────
-- 6. admin_grant_points — 기존 함수 개선 (admin_id 기록 추가)
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_grant_points(
  p_user_id    UUID,
  p_amount     INT,
  p_type       point_tx_type DEFAULT 'admin_grant',
  p_description TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id    UUID;
  v_new_balance INT;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  IF p_type NOT IN ('admin_grant', 'admin_deduct') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE');
  END IF;

  v_admin_id := auth.uid();

  -- user_profiles.points 업데이트 (원자적)
  UPDATE user_profiles
  SET points = GREATEST(0, points + p_amount)
  WHERE id = p_user_id
  RETURNING points INTO v_new_balance;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  END IF;

  -- 거래 기록
  INSERT INTO point_transactions (user_id, type, amount, balance_after, description, ref_type, admin_id)
  VALUES (p_user_id, p_type, p_amount, v_new_balance, p_description, 'admin', v_admin_id);

  RETURN jsonb_build_object('ok', true, 'new_balance', v_new_balance);
END;
$$;

-- ─────────────────────────────────────────────────────────
-- 7. admin_bulk_grant_points — 일괄 포인트 발행
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_bulk_grant_points(
  p_grants JSONB   -- [{"user_id": "...", "amount": 500, "description": "리뷰 보상"}, ...]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item           JSONB;
  v_user_id        UUID;
  v_amount         INT;
  v_desc           TEXT;
  v_total          INT := 0;
  v_success        INT := 0;
  v_fail           INT := 0;
  v_new_balance    INT;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_grants)
  LOOP
    v_total := v_total + 1;
    BEGIN
      v_user_id := (v_item->>'user_id')::UUID;
      v_amount  := (v_item->>'amount')::INT;
      v_desc    := v_item->>'description';

      UPDATE user_profiles
      SET points = GREATEST(0, points + v_amount)
      WHERE id = v_user_id
      RETURNING points INTO v_new_balance;

      IF NOT FOUND THEN
        v_fail := v_fail + 1;
        CONTINUE;
      END IF;

      INSERT INTO point_transactions (user_id, type, amount, balance_after, description, ref_type, admin_id)
      VALUES (v_user_id, 'admin_grant', v_amount, v_new_balance, v_desc, 'admin', auth.uid());

      v_success := v_success + 1;
    EXCEPTION WHEN OTHERS THEN
      v_fail := v_fail + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'total_processed', v_total,
    'success_count',   v_success,
    'fail_count',      v_fail
  );
END;
$$;

-- ─────────────────────────────────────────────────────────
-- 8. update_point_earn_rule — 적립 규칙 업데이트
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_point_earn_rule(
  p_event_type       VARCHAR(30),
  p_amount           INT DEFAULT NULL,
  p_rate             NUMERIC(5,4) DEFAULT NULL,
  p_is_active        BOOLEAN DEFAULT NULL,
  p_grade_multipliers JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  UPDATE point_earn_rules
  SET
    amount            = COALESCE(p_amount, amount),
    rate              = COALESCE(p_rate, rate),
    is_active         = COALESCE(p_is_active, is_active),
    grade_multipliers = COALESCE(p_grade_multipliers, grade_multipliers),
    updated_at        = now()
  WHERE event_type = p_event_type;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RULE_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ─────────────────────────────────────────────────────────
-- 9. get_point_earn_rules — 적립 규칙 목록 조회
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_point_earn_rules()
RETURNS TABLE (
  event_type        VARCHAR,
  amount            INT,
  rate              NUMERIC,
  is_active         BOOLEAN,
  grade_multipliers JSONB,
  description       TEXT,
  updated_at        TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  RETURN QUERY
  SELECT
    r.event_type, r.amount, r.rate, r.is_active,
    r.grade_multipliers, r.description, r.updated_at
  FROM point_earn_rules r
  ORDER BY r.event_type;
END;
$$;
