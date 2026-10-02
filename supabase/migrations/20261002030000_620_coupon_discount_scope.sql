-- Migration 620 — 쿠폰 할인 범위(discount_scope) 신설 (2026-10-02, Stephen 확정 정책)
--
-- 배경: "방문 픽업·반납 (1일차 10%)" 쿠폰이 총 대여요금 전체에 10%로 계산되던 오류.
--   · 정률 쿠폰은 같은 기준 금액에 "합산"해서 적용한다(순차 복리 아님).
--   · 1일차 한정 쿠폰은 총액이 아니라 "1일차 요금"에만 적용한다.
--
-- discount_scope
--   'order'     — 주문 전체 금액(정액 차감 후 잔액) 기준 (기본값, 기존 동작)
--   'first_day' — 대여 1일차 요금 기준 (정률 쿠폰만 가능)
--
-- 이 마이그레이션은 스키마·설정 RPC·방문 쿠폰 지정만 다룬다. 계산식은 Migration 621.

ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS discount_scope TEXT NOT NULL DEFAULT 'order';

ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_discount_scope_check;
ALTER TABLE public.coupons
  ADD CONSTRAINT coupons_discount_scope_check CHECK (discount_scope IN ('order', 'first_day'));

ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_first_day_percentage_only;
ALTER TABLE public.coupons
  ADD CONSTRAINT coupons_first_day_percentage_only
  CHECK (discount_scope = 'order' OR discount_type = 'percentage');

COMMENT ON COLUMN public.coupons.discount_scope IS
  '할인 적용 범위. order=주문 전체(정액 차감 후 잔액) / first_day=대여 1일차 요금(정률 전용). 같은 범위의 정률 쿠폰은 율을 합산해 적용.';

-- CMS 설정 RPC (cms_set_allow_coupon_stacking와 같은 패턴 — 쿠폰 생성·수정 후 호출)
CREATE OR REPLACE FUNCTION public.cms_set_coupon_discount_scope(
  p_id    UUID,
  p_scope TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_type TEXT;
BEGIN
  IF NOT (COALESCE(auth.role(), '') = 'service_role' OR public.is_cms_user()) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  IF p_scope IS NULL OR p_scope NOT IN ('order', 'first_day') THEN
    RAISE EXCEPTION 'INVALID_DISCOUNT_SCOPE: %', COALESCE(p_scope, 'NULL');
  END IF;

  SELECT discount_type INTO v_type FROM coupons WHERE id = p_id AND deleted_at IS NULL;
  IF v_type IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COUPON_NOT_FOUND');
  END IF;

  IF p_scope = 'first_day' AND v_type <> 'percentage' THEN
    RAISE EXCEPTION 'FIRST_DAY_SCOPE_PERCENTAGE_ONLY';
  END IF;

  UPDATE coupons SET discount_scope = p_scope, updated_at = now() WHERE id = p_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.cms_set_coupon_discount_scope(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cms_set_coupon_discount_scope(UUID, TEXT) TO authenticated, service_role;

-- 방문 픽업·반납 1일차 10% 쿠폰만 first_day로 지정 (다른 쿠폰은 모두 기본 order 유지)
UPDATE public.coupons
SET discount_scope = 'first_day'
WHERE display_name = '방문 픽업·반납 (1일차 10%할인)'
  AND discount_type = 'percentage'
  AND is_walk_in_only = true;
