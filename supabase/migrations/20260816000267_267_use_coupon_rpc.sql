-- Migration 267: use_coupon RPC 신설
-- 결함: 체크아웃에서 쿠폰을 선택해 할인 화면에는 반영되지만, 결제 확정(confirm-mock) 경로
-- 어디에도 user_coupons.used_at / coupons.usage_count를 반영하는 로직이 없어 쿠폰이 실제로는
-- 전혀 소진되지 않던 기존 갭(2026-08-15 주문그룹핑 세션에서 발견·플래그, 이번 세션에서 수정)

CREATE OR REPLACE FUNCTION public.use_coupon(
  p_user_id        UUID,
  p_user_coupon_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uc RECORD;
BEGIN
  SELECT uc.id, uc.coupon_id, uc.used_at, c.is_active, c.deleted_at, c.valid_from, c.valid_until
  INTO v_uc
  FROM user_coupons uc
  JOIN coupons c ON c.id = uc.coupon_id
  WHERE uc.id = p_user_coupon_id AND uc.user_id = p_user_id
  FOR UPDATE OF uc;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COUPON_NOT_FOUND');
  END IF;

  IF v_uc.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_USED');
  END IF;

  IF NOT v_uc.is_active OR v_uc.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COUPON_INACTIVE');
  END IF;

  IF v_uc.valid_until IS NOT NULL AND v_uc.valid_until < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COUPON_EXPIRED');
  END IF;

  UPDATE user_coupons
  SET used_at = now(), used_count = used_count + 1
  WHERE id = p_user_coupon_id;

  UPDATE coupons
  SET usage_count = usage_count + 1
  WHERE id = v_uc.coupon_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.use_coupon(UUID, UUID) TO authenticated;
