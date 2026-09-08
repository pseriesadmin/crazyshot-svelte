-- 쿠폰 발행관리 개선 항목 1: cms_create_coupon에 p_display_name 파라미터 추가
--
-- ⛔ CREATE OR REPLACE로 파라미터를 늘리면 기존 시그니처를 교체하지 않고 별도 오버로드로
-- 추가된다는 걸 이번 세션 초반(migration 293→294)에 실제로 겪었으므로, 반드시 기존
-- 28-param 시그니처를 명시적으로 DROP한 뒤 29-param으로 재생성한다.
DROP FUNCTION IF EXISTS public.cms_create_coupon(
  text, text, text, numeric, integer, numeric, timestamp with time zone,
  timestamp with time zone, text, integer, integer, numeric, jsonb, text,
  boolean, integer, integer, boolean, boolean, boolean, boolean, jsonb, jsonb,
  text, boolean, boolean, jsonb, text
);

CREATE OR REPLACE FUNCTION public.cms_create_coupon(
  p_code                  TEXT        DEFAULT NULL,
  p_type                  TEXT        DEFAULT 'all',
  p_discount_type         TEXT        DEFAULT 'fixed',
  p_discount_value        NUMERIC     DEFAULT 0,
  p_usage_limit           INTEGER     DEFAULT NULL,
  p_min_purchase_amount   NUMERIC     DEFAULT 0,
  p_valid_from            TIMESTAMPTZ DEFAULT NULL,
  p_valid_until           TIMESTAMPTZ DEFAULT NULL,
  p_description           TEXT        DEFAULT NULL,
  p_min_rental_amount     INTEGER     DEFAULT 0,
  p_min_rental_days       INTEGER     DEFAULT 0,
  p_max_discount_amount   NUMERIC     DEFAULT NULL,
  p_applicable_categories JSONB       DEFAULT NULL,
  p_user_grade_required   TEXT        DEFAULT NULL,
  p_is_first_rental_only  BOOLEAN     DEFAULT FALSE,
  p_per_user_limit        INTEGER     DEFAULT 1,
  p_total_usage_limit     INTEGER     DEFAULT NULL,
  p_is_student_only       BOOLEAN     DEFAULT FALSE,
  p_is_walk_in_only       BOOLEAN     DEFAULT FALSE,
  p_is_subscription_only  BOOLEAN     DEFAULT FALSE,
  p_auto_issue_enabled    BOOLEAN     DEFAULT FALSE,
  p_auto_issue_schedule   JSONB       DEFAULT NULL,
  p_distribution_target   JSONB       DEFAULT NULL,
  p_validity_type         TEXT        DEFAULT 'fixed_period',
  p_allow_with_points     BOOLEAN     DEFAULT TRUE,
  p_allow_stacking        BOOLEAN     DEFAULT FALSE,
  p_code_series           JSONB       DEFAULT NULL,
  p_code_mode             TEXT        DEFAULT 'manual',
  p_display_name          TEXT        DEFAULT NULL  -- 항목 1 신규: 고객 노출용 이름
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  -- B-5 서버사이드 검증: code_mode별 필수 필드 체크
  IF p_code_mode = 'manual' AND (p_code IS NULL OR p_code = '') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'manual 모드에서는 쿠폰 코드가 필수입니다.');
  END IF;

  IF p_code_mode = 'sequenced' AND p_code_series IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sequenced 모드에서는 code_series가 필수입니다.');
  END IF;

  IF p_code_mode NOT IN ('manual', 'sequenced') THEN
    RETURN jsonb_build_object('ok', false, 'error', '유효하지 않은 code_mode입니다.');
  END IF;

  INSERT INTO public.coupons (
    code, type, discount_type, discount_value, usage_limit,
    min_purchase_amount, valid_from, valid_until, description,
    is_active, usage_count,
    min_rental_amount, min_rental_days, max_discount_amount,
    applicable_categories, user_grade_required, is_first_rental_only,
    per_user_limit, total_usage_limit,
    is_student_only, is_walk_in_only, is_subscription_only,
    auto_issue_enabled, auto_issue_schedule, distribution_target,
    validity_type, allow_with_points, allow_stacking,
    code_series, code_mode,
    display_name                                             -- 항목 1 신규
  ) VALUES (
    NULLIF(TRIM(p_code), ''),        -- sequenced 모드는 NULL, manual은 트림된 코드
    p_type, p_discount_type, p_discount_value, p_usage_limit,
    p_min_purchase_amount,
    CASE WHEN p_validity_type = 'unlimited' THEN NULL ELSE p_valid_from  END,
    CASE WHEN p_validity_type = 'unlimited' THEN NULL ELSE p_valid_until END,
    p_description,
    TRUE, 0,
    p_min_rental_amount, p_min_rental_days, p_max_discount_amount,
    p_applicable_categories, p_user_grade_required, p_is_first_rental_only,
    p_per_user_limit, p_total_usage_limit,
    p_is_student_only, p_is_walk_in_only, p_is_subscription_only,
    p_auto_issue_enabled, p_auto_issue_schedule, p_distribution_target,
    p_validity_type, p_allow_with_points, p_allow_stacking,
    p_code_series, p_code_mode,
    NULLIF(TRIM(p_display_name), '')                         -- 항목 1 신규
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;
