-- Migration 521: cms_update_coupon — relative_days 쿠폰 모드 신설 (valid_days 파라미터 추가)
--
-- 배경: "첫 확인일로부터 N일" 유효기간(relative_days) 쿠폰 수정 시, CMS가 valid_days를
--   저장할 경로가 없어 relative_days 쿠폰을 발행한 뒤 이 값을 바꿀 수 없었음.
--
-- 수정: 기존 22-param을 DROP 후 p_valid_days INTEGER DEFAULT NULL을 추가한 23-param으로 재생성.
--   valid_from/valid_until CASE 조건에 relative_days 추가(fixed_period만 절대일자 저장).
--   valid_days UPDATE 컬럼 추가 — relative_days 모드일 때만 저장, 그 외 NULL.
--
-- 롤백: 20260921050000_515_cms_update_coupon_full_field_parity.sql의 22-param 정의로
--   되돌릴 것.

DROP FUNCTION IF EXISTS public.cms_update_coupon(
  uuid, text, numeric, numeric, integer, text, text,
  timestamp with time zone, timestamp with time zone,
  text, text, numeric, integer, integer, integer, jsonb,
  boolean, boolean, boolean, boolean, boolean, boolean
);

CREATE OR REPLACE FUNCTION public.cms_update_coupon(
  p_id uuid,
  p_discount_type text,
  p_discount_value numeric,
  p_max_discount_amount numeric,
  p_total_usage_limit integer,
  p_user_grade_required text,
  p_validity_type text,
  p_valid_from timestamp with time zone,
  p_valid_until timestamp with time zone,
  p_display_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_min_purchase_amount numeric DEFAULT 0,
  p_min_rental_amount integer DEFAULT 0,
  p_min_rental_days integer DEFAULT 0,
  p_per_user_limit integer DEFAULT 1,
  p_applicable_categories jsonb DEFAULT NULL,
  p_is_first_rental_only boolean DEFAULT false,
  p_is_student_only boolean DEFAULT false,
  p_is_walk_in_only boolean DEFAULT false,
  p_is_subscription_only boolean DEFAULT false,
  p_allow_with_points boolean DEFAULT true,
  p_allow_stacking boolean DEFAULT false,
  p_valid_days integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  UPDATE public.coupons
     SET discount_type        = p_discount_type,
         discount_value       = p_discount_value,
         max_discount_amount  = p_max_discount_amount,
         total_usage_limit    = p_total_usage_limit,
         user_grade_required  = p_user_grade_required,
         validity_type        = p_validity_type,
         valid_from  = CASE WHEN p_validity_type IN ('unlimited', 'relative_days') THEN NULL ELSE p_valid_from  END,
         valid_until = CASE WHEN p_validity_type IN ('unlimited', 'relative_days') THEN NULL ELSE p_valid_until END,
         valid_days  = CASE WHEN p_validity_type = 'relative_days' THEN p_valid_days ELSE NULL END,
         display_name         = NULLIF(TRIM(p_display_name), ''),
         description           = NULLIF(TRIM(p_description), ''),
         min_purchase_amount   = p_min_purchase_amount,
         min_rental_amount     = p_min_rental_amount,
         min_rental_days       = p_min_rental_days,
         per_user_limit        = p_per_user_limit,
         applicable_categories = p_applicable_categories,
         is_first_rental_only  = p_is_first_rental_only,
         is_student_only       = p_is_student_only,
         is_walk_in_only       = p_is_walk_in_only,
         is_subscription_only  = p_is_subscription_only,
         allow_with_points     = p_allow_with_points,
         allow_stacking        = p_allow_stacking
   WHERE id = p_id
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COUPON_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;
