-- Migration 512: cms_create_coupon — coupons.type enum 캐스팅 누락 결함 수정
--
-- 증상: CMS 쿠폰 발행(/cms/promotion/coupon/new) 시도 시 discount_type·code_mode와
--       무관하게 항상 실패 — cms_create_coupon 내부에서
--       'column "type" is of type coupon_type_enum but expression is of type text'
--       오류가 발생해 화면에 경고 토스트만 뜨고 어떤 쿠폰도 발행되지 않고 있었음
--       (Stephen 재보고로 2026-09-21 실제 재현·확인).
--
-- 원인: coupons.type 컬럼이 (이 함수 작성 이후 시점에) TEXT에서 coupon_type_enum으로
--       바뀌었으나, cms_create_coupon의 INSERT는 text 파라미터(p_type)를 그대로
--       바인딩하고 있었다 — plpgsql은 함수 파라미터(text) → enum 컬럼 자동 캐스팅을
--       지원하지 않아(리터럴이 아닌 바인드 파라미터라 unknown-type 추론이 적용되지 않음)
--       모든 INSERT 시도가 예외로 이어졌다.
--
-- 수정: INSERT VALUES의 p_type에 ::public.coupon_type_enum 명시적 캐스팅만 추가.
--       나머지 로직·시그니처는 전부 무변경.
--
-- 롤백: 20260818060000_293_coupon_lazy_rpc_integration.sql(cms_create_coupon 최초 정의)
--       + 그 이후 p_display_name 추가 마이그레이션으로 되돌릴 것.

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
  p_display_name text DEFAULT NULL::text
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
    display_name
  ) VALUES (
    NULLIF(TRIM(p_code), ''),
    p_type::public.coupon_type_enum, p_discount_type, p_discount_value, p_usage_limit,
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
    NULLIF(TRIM(p_display_name), '')
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;
