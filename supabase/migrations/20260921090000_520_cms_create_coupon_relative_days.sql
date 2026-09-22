-- Migration 520: cms_create_coupon — relative_days 쿠폰 모드 신설 (valid_days 파라미터 추가)
--
-- 배경: "첫 확인일로부터 N일" 유효기간(relative_days) 쿠폰 발행을 CMS에서 지원하기 위해
--   coupons.valid_days INTEGER 컬럼(Migration 516)을 실제로 저장하는 경로 추가.
--
-- 수정: 기존 29-param을 DROP 후 p_valid_days INTEGER DEFAULT NULL을 추가한 30-param으로 재생성.
--   valid_from/valid_until CASE 조건에 relative_days 추가
--   (fixed_period 모드만 절대일자를 사용하고, unlimited·relative_days는 NULL 저장).
--
-- 롤백: 20260921020000_512_cms_create_coupon_type_enum_cast_fix.sql의 29-param 정의로
--   되돌릴 것. (최종 라이브 정의: CREATE OR REPLACE 29-param)
--
-- 주의: p_code_mode NOT IN ('manual', 'sequenced') 기존 검증 무변경 — 30번 파라미터가
--   추가됐을 뿐 나머지 로직 전부 Migration 512와 동일.

DROP FUNCTION IF EXISTS public.cms_create_coupon(
  text, text, text, numeric, integer, numeric,
  timestamp with time zone, timestamp with time zone,
  text, integer, integer, numeric, jsonb, text,
  boolean, integer, integer, boolean, boolean, boolean, boolean,
  jsonb, jsonb, text, boolean, boolean, jsonb, text, text
);

CREATE OR REPLACE FUNCTION public.cms_create_coupon(
  p_code text DEFAULT NULL::text,
  p_type text DEFAULT 'all'::text,
  p_discount_type text DEFAULT 'fixed'::text,
  p_discount_value numeric DEFAULT 0,
  p_usage_limit integer DEFAULT NULL::integer,
  p_min_purchase_amount numeric DEFAULT 0,
  p_valid_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_valid_until timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_description text DEFAULT NULL::text,
  p_min_rental_amount integer DEFAULT 0,
  p_min_rental_days integer DEFAULT 0,
  p_max_discount_amount numeric DEFAULT NULL::numeric,
  p_applicable_categories jsonb DEFAULT NULL::jsonb,
  p_user_grade_required text DEFAULT NULL::text,
  p_is_first_rental_only boolean DEFAULT false,
  p_per_user_limit integer DEFAULT 1,
  p_total_usage_limit integer DEFAULT NULL::integer,
  p_is_student_only boolean DEFAULT false,
  p_is_walk_in_only boolean DEFAULT false,
  p_is_subscription_only boolean DEFAULT false,
  p_auto_issue_enabled boolean DEFAULT false,
  p_auto_issue_schedule jsonb DEFAULT NULL::jsonb,
  p_distribution_target jsonb DEFAULT NULL::jsonb,
  p_validity_type text DEFAULT 'fixed_period'::text,
  p_allow_with_points boolean DEFAULT true,
  p_allow_stacking boolean DEFAULT false,
  p_code_series jsonb DEFAULT NULL::jsonb,
  p_code_mode text DEFAULT 'manual'::text,
  p_display_name text DEFAULT NULL::text,
  p_valid_days integer DEFAULT NULL::integer
)
RETURNS jsonb
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
    display_name,
    valid_days
  ) VALUES (
    NULLIF(TRIM(p_code), ''),
    p_type::public.coupon_type_enum, p_discount_type, p_discount_value, p_usage_limit,
    p_min_purchase_amount,
    CASE WHEN p_validity_type IN ('unlimited', 'relative_days') THEN NULL ELSE p_valid_from  END,
    CASE WHEN p_validity_type IN ('unlimited', 'relative_days') THEN NULL ELSE p_valid_until END,
    p_description,
    TRUE, 0,
    p_min_rental_amount, p_min_rental_days, p_max_discount_amount,
    p_applicable_categories, p_user_grade_required, p_is_first_rental_only,
    p_per_user_limit, p_total_usage_limit,
    p_is_student_only, p_is_walk_in_only, p_is_subscription_only,
    p_auto_issue_enabled, p_auto_issue_schedule, p_distribution_target,
    p_validity_type, p_allow_with_points, p_allow_stacking,
    p_code_series, p_code_mode,
    NULLIF(TRIM(p_display_name), ''),
    CASE WHEN p_validity_type = 'relative_days' THEN p_valid_days ELSE NULL END
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;
