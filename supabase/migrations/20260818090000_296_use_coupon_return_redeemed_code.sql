-- Migration 296: use_coupon이 채번된 redeemed_code를 응답에 포함하도록 확장
-- 배경: sequenced 모드 쿠폰을 결제에 사용하면 generate_user_coupon_redeemed_code가
--   내부적으로 코드를 채번하지만(migration 293), 그 값이 use_coupon의 반환 JSON에
--   실리지 않아 고객이 자신이 받은 코드를 어디서도 확인할 수 없었다(CMS에만 존재) —
--   Stephen 요청(2026-08-18)으로 고객 노출 경로 구현.
-- 변경: PERFORM(반환값 폐기) → SELECT...INTO로 값을 받아 응답 JSON에 'redeemed_code'로
--   포함. manual 모드 쿠폰은 generate_user_coupon_redeemed_code가 NULL을 반환하므로
--   응답에도 redeemed_code: null 그대로 — 기존 동작(코드 필드 없음)과 동일.
-- 기존 로직(used_at/used_count/usage_count 세팅, 에러 케이스 4종)은 한 글자도 안 바뀜.
-- 2026-08-18

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
  v_redeemed_code TEXT;
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

  -- sequenced 모드 쿠폰에만 redeemed_code 채번 (manual은 NULL 반환으로 무동작)
  SELECT public.generate_user_coupon_redeemed_code(p_user_coupon_id) INTO v_redeemed_code;

  RETURN jsonb_build_object('ok', true, 'redeemed_code', v_redeemed_code);
END;
$$;

GRANT EXECUTE ON FUNCTION public.use_coupon(UUID, UUID) TO authenticated;
