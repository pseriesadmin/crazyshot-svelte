-- Migration #48: 프로모션 RPC 함수 4종
-- 쿠폰 통계·리포트 / 포인트 통계·원자적 발행
-- Phase 1: 프로모션 모듈 기반 RPC (SECURITY DEFINER)

-- ─────────────────────────────────────────────────────────
-- 1. 쿠폰 통계
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_coupon_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_issued  INT;
  v_total_active  INT;
  v_total_used    INT;
  v_total_expired INT;
BEGIN
  SELECT COUNT(*)
    INTO v_total_issued
    FROM public.coupons
   WHERE deleted_at IS NULL;

  SELECT COUNT(*)
    INTO v_total_active
    FROM public.coupons
   WHERE is_active = true
     AND deleted_at IS NULL
     AND (valid_until IS NULL OR valid_until >= now());

  SELECT COALESCE(SUM(usage_count), 0)
    INTO v_total_used
    FROM public.coupons
   WHERE deleted_at IS NULL;

  SELECT COUNT(*)
    INTO v_total_expired
    FROM public.coupons
   WHERE valid_until IS NOT NULL
     AND valid_until < now()
     AND deleted_at IS NULL;

  RETURN jsonb_build_object(
    'total_issued',  v_total_issued,
    'total_active',  v_total_active,
    'total_used',    v_total_used,
    'total_expired', v_total_expired
  );
END;
$$;

-- ─────────────────────────────────────────────────────────
-- 2. 쿠폰 기간별 사용량 리포트
-- p_period: 'day' | 'month' | 'year'
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_coupon_usage_report(
  p_period TEXT,
  p_from   TIMESTAMPTZ,
  p_to     TIMESTAMPTZ
)
RETURNS TABLE(
  period      TEXT,
  used_count  BIGINT,
  coupon_code TEXT,
  coupon_type TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    to_char(date_trunc(p_period, uc.created_at), 'YYYY-MM-DD') AS period,
    COUNT(*)::BIGINT                                            AS used_count,
    c.code                                                      AS coupon_code,
    c.type::TEXT                                                AS coupon_type
  FROM public.user_coupons uc
  JOIN public.coupons c ON c.id = uc.coupon_id
  WHERE uc.created_at BETWEEN p_from AND p_to
    AND uc.used_at IS NOT NULL
  GROUP BY date_trunc(p_period, uc.created_at), c.code, c.type
  ORDER BY date_trunc(p_period, uc.created_at) DESC;
END;
$$;

-- ─────────────────────────────────────────────────────────
-- 3. 포인트 통계
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_point_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_granted BIGINT;
  v_total_used    BIGINT;
  v_total_balance BIGINT;
BEGIN
  SELECT COALESCE(SUM(amount), 0)
    INTO v_total_granted
    FROM public.point_transactions
   WHERE amount > 0;

  SELECT COALESCE(ABS(SUM(amount)), 0)
    INTO v_total_used
    FROM public.point_transactions
   WHERE amount < 0;

  SELECT COALESCE(SUM(points), 0)
    INTO v_total_balance
    FROM public.user_profiles;

  RETURN jsonb_build_object(
    'total_granted', v_total_granted,
    'total_used',    v_total_used,
    'total_balance', v_total_balance
  );
END;
$$;

-- ─────────────────────────────────────────────────────────
-- 4. 관리자 포인트 발행 (원자적 — user_profiles.points + point_transactions 동기화)
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_grant_points(
  p_user_id     UUID,
  p_amount      INT,          -- 양수(적립) 또는 음수(차감)
  p_type        public.point_tx_type,
  p_description TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance INT;
BEGIN
  -- 관리자 권한 확인
  IF NOT public.is_cms_user() THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  -- 차감 시 잔액 부족 체크
  IF p_amount < 0 THEN
    SELECT points INTO v_new_balance
      FROM public.user_profiles
     WHERE user_id = p_user_id;

    IF v_new_balance + p_amount < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'insufficient_points');
    END IF;
  END IF;

  -- user_profiles.points 갱신
  UPDATE public.user_profiles
     SET points = points + p_amount
   WHERE user_id = p_user_id
  RETURNING points INTO v_new_balance;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;

  -- 트랜잭션 이력 기록
  INSERT INTO public.point_transactions(user_id, type, amount, balance_after, description, ref_type)
  VALUES (p_user_id, p_type, p_amount, v_new_balance, p_description, 'admin');

  RETURN jsonb_build_object(
    'success',      true,
    'new_balance',  v_new_balance
  );
END;
$$;
