-- Migration 299: get_coupon_redemptions — manual 모드 사용 이력도 포함하도록 확장
-- 배경: Stephen 확정(2026-08-18) — 사용량 리포트 탭에서 여는 CouponDetailPanel의 '배포' 탭을
--   '사용 채번 목록'으로 완전히 대체(발행관리 탭 쪽 '배포' 탭은 그대로 유지, 중복이라 판단).
--   이 목록은 이제 sequenced 모드 전용이 아니라 모든 쿠폰(manual 포함)의 "누가 언제 사용했는지"
--   조회 화면이 됐으므로, 기존 `WHERE uc.redeemed_code IS NOT NULL` 조건이 manual 모드 사용
--   이력을 전부 걸러내던 것을 `WHERE uc.used_at IS NOT NULL`로 완화한다.
--   redeemed_code가 NULL인 행(manual 모드)은 프론트가 coupon.code로 대체 표시.
-- 2026-08-18

CREATE OR REPLACE FUNCTION public.get_coupon_redemptions(p_coupon_id UUID)
RETURNS TABLE(
  user_coupon_id      UUID,
  redeemed_code       TEXT,
  used_at             TIMESTAMPTZ,
  user_name           TEXT,
  user_email          TEXT,
  reservation_id      BIGINT,
  reservation_status  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    uc.id,
    uc.redeemed_code,
    uc.used_at,
    up.full_name,
    up.email,
    rr.id,
    rr.status
  FROM user_coupons uc
  LEFT JOIN user_profiles up ON up.id = uc.user_id
  LEFT JOIN LATERAL (
    SELECT oi.reservation_id
    FROM order_items oi
    WHERE oi.order_id = uc.order_id
    ORDER BY oi.id ASC
    LIMIT 1
  ) first_item ON true
  LEFT JOIN rental_reservations rr ON rr.id = first_item.reservation_id
  WHERE uc.coupon_id = p_coupon_id
    AND uc.used_at IS NOT NULL   -- FIX: redeemed_code IS NOT NULL → used_at IS NOT NULL
  ORDER BY uc.used_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_coupon_redemptions(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_coupon_redemptions(UUID) TO service_role;

COMMENT ON FUNCTION public.get_coupon_redemptions(UUID) IS
  'CMS 쿠폰 관리 화면 "사용 채번 목록" 전용(사용량 리포트 탭 DetailPanel에서 "배포" 탭을
   대체). manual/sequenced 모드 구분 없이 실제 사용(used_at IS NOT NULL)된 이력 전체를
   반환 — redeemed_code는 sequenced 모드만 값이 있고 manual 모드는 NULL(프론트에서
   coupon.code로 대체 표시). reservation_id는 그 사용이 속한 주문의 대표 예약(가장 먼저
   연결된 것) 1건, 없으면 NULL.';
