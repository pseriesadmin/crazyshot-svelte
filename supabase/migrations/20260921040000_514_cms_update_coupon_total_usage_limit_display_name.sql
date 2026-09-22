-- Migration 514: cms_update_coupon — 전체 발급 한도 컬럼 오배선 수정 + 쿠폰이름 편집 지원
--
-- 증상(Stephen 재보고): CMS 쿠폰 발행관리(/cms/promotion/coupon?tab=manage) 목록·상세패널
--   전반에서 "유효기간"·"사용/한도" 항목이 실제 값과 다르게 표시되고, 쿠폰이름이 어디에도
--   노출되지 않음.
--
-- 원인 1: 쿠폰 생성화면(/cms/promotion/coupon/new)은 "전체 발급 한도(0=무제한)"를 처음부터
--   coupons.total_usage_limit 컬럼에 저장해왔는데, 이 수정(cms_update_coupon) 경로만
--   잘못된 컬럼(usage_limit — 장바구니 자격조건 검증 등 별개 용도로 쓰이는 컬럼)을 읽고
--   써왔다. 그 결과 관리자가 실제로 설정한 발급 한도가 목록·상세패널 어디에도 반영되지
--   않고 늘 "0 / ∞"로 보였다. usage_limit 컬럼 자체(및 그 값을 읽는 다른 로직)는 이번
--   수정 대상이 아니며 그대로 유지 — 이 RPC의 바인딩만 total_usage_limit으로 교정한다.
-- 원인 2: 쿠폰이름(display_name, Migration #cb26bc3 커밋에서 신설)을 이 RPC가 애초에
--   파라미터로 받지 않아 발행 후에는 수정할 방법이 없었다.
--
-- 수정: 기존 9-param 시그니처를 DROP 후, p_usage_limit → p_total_usage_limit로 교체하고
--   p_display_name을 추가한 10-param으로 재생성(파라미터 개수가 달라지는 재정의는
--   CREATE OR REPLACE만으로는 새 오버로드를 만들 뿐 기존 정의를 대체하지 않으므로 —
--   이 세션 앞선 작업에서 이미 겪은 패턴과 동일 — 반드시 DROP 선행).
--
-- 롤백: 20260818060000_293_coupon_lazy_rpc_integration.sql 이후 cms_update_coupon 최초
--   정의(9-param, p_usage_limit 버전)로 되돌릴 것.

DROP FUNCTION IF EXISTS public.cms_update_coupon(uuid, text, numeric, numeric, integer, text, text, timestamp with time zone, timestamp with time zone);

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
  p_display_name text DEFAULT NULL
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
     SET discount_type       = p_discount_type,
         discount_value      = p_discount_value,
         max_discount_amount = p_max_discount_amount,
         total_usage_limit   = p_total_usage_limit,
         user_grade_required = p_user_grade_required,
         validity_type       = p_validity_type,
         valid_from  = CASE WHEN p_validity_type = 'unlimited' THEN NULL ELSE p_valid_from  END,
         valid_until = CASE WHEN p_validity_type = 'unlimited' THEN NULL ELSE p_valid_until END,
         display_name = NULLIF(TRIM(p_display_name), '')
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
