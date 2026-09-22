-- Migration 515: cms_update_coupon — 발행 후에는 확인·수정 불가능했던 나머지 필드 전부 지원
--
-- 배경(Stephen "4번 지적사항 관련 — 추가로 발견한 사항" 구현 지시): 쿠폰 생성화면
-- (/cms/promotion/coupon/new)에는 있지만, 발행 후 상세패널(CouponDetailPanel)에는 전혀
-- 노출·편집되지 않던 필드들 — 이번 세션 앞선 두 작업(Migration #510~512, #514)에서 실제로
-- 동작하도록 고친 allow_stacking·allow_with_points·per_user_limit·applicable_categories를
-- 포함해, 한 번 발행한 쿠폰은 이 값들을 확인할 방법도 바꿀 방법도 없었다.
--
-- 수정: 기존 10-param 시그니처(Migration #514)를 DROP 후, 아래 12개 파라미터를 추가한
--   22-param으로 재생성(파라미터 개수가 달라지는 재정의는 CREATE OR REPLACE만으로는 새
--   오버로드를 만들 뿐 기존 정의를 대체하지 않으므로 DROP 선행 — 이 세션에서 반복 확인된
--   패턴):
--   p_description, p_min_purchase_amount, p_min_rental_amount, p_min_rental_days,
--   p_per_user_limit, p_applicable_categories, p_is_first_rental_only, p_is_student_only,
--   p_is_walk_in_only, p_is_subscription_only, p_allow_with_points, p_allow_stacking
--
-- 롤백: 20260921040000_514_cms_update_coupon_total_usage_limit_display_name.sql의
--   10-param 정의로 되돌릴 것.

DROP FUNCTION IF EXISTS public.cms_update_coupon(uuid, text, numeric, numeric, integer, text, text, timestamp with time zone, timestamp with time zone, text);

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
  p_allow_stacking boolean DEFAULT false
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
         valid_from  = CASE WHEN p_validity_type = 'unlimited' THEN NULL ELSE p_valid_from  END,
         valid_until = CASE WHEN p_validity_type = 'unlimited' THEN NULL ELSE p_valid_until END,
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
