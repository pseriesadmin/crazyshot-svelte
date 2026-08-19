-- Migration 301: get_coupon_redemptions — 랜딩 대상을 다시 "대여 정보"(RentalDetailPanel)로
-- 배경: Stephen 재수정(2026-08-18, "[재수정]") — CustomerDetailPanel이 아니라 그 사용자의
--   대여 정보를 보여주는 RentalDetailPanel(/cms/reservation 또는 /cms/rentals)로 랜딩해야
--   함. 다만 "쿠폰 사용자의 대여 정보를 확인하기 위한 랜딩값"이라는 명시적 목적에 따라,
--   이번에도 "이 코드가 정확히 어느 예약에 쓰였는지"를 추적하려는 게 아니라(그건 N:1이라
--   원천적으로 불가능 — service-operations.md 참고) "그 사용자의 대여 정보를 아무거나 하나
--   보여주면 된다"는 의미로 확정 — migration 300에서 도입한 user_id 매칭 원칙은 그대로
--   유지하되, order_id/order_items 경유 대신 그 user_id로 가장 최근 예약 1건을 직접 조회.
--   "여러 쿠폰을 중복 사용해도 항상 정확히 해당 사용자로 랜딩"이 되도록 user_id 기준은
--   그대로 유지(순수 order_id 조인 방식보다 훨씬 단순·안정적).
-- 2026-08-18

DROP FUNCTION IF EXISTS public.get_coupon_redemptions(UUID);

CREATE OR REPLACE FUNCTION public.get_coupon_redemptions(p_coupon_id UUID)
RETURNS TABLE(
  user_coupon_id      UUID,
  user_id             UUID,
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
    uc.user_id,
    uc.redeemed_code,
    uc.used_at,
    up.full_name,
    up.email,
    rep.id,
    rep.status
  FROM user_coupons uc
  LEFT JOIN user_profiles up ON up.id = uc.user_id
  -- 대표 예약: 이 쿠폰 거래와 무관하게, 그 사용자의 가장 최근 예약 1건(대여 정보 확인이
  -- 목적이라 "정확히 이 코드로 결제한 예약"을 추적하지 않음 — Stephen 확정)
  LEFT JOIN LATERAL (
    SELECT rr.id, rr.status
    FROM rental_reservations rr
    WHERE rr.user_id = uc.user_id
    ORDER BY rr.created_at DESC
    LIMIT 1
  ) rep ON true
  WHERE uc.coupon_id = p_coupon_id
    AND uc.used_at IS NOT NULL
  ORDER BY uc.used_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_coupon_redemptions(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_coupon_redemptions(UUID) TO service_role;

COMMENT ON FUNCTION public.get_coupon_redemptions(UUID) IS
  'CMS 쿠폰 관리 화면 "사용 채번 목록" 전용. manual/sequenced 모드 구분 없이 실제 사용
   (used_at IS NOT NULL)된 이력을 반환하며, 각 행의 reservation_id로 RentalDetailPanel
   (/cms/reservation 또는 /cms/rentals, status 기준 분기)에 랜딩한다. reservation_id는
   "이 쿠폰이 결제된 정확한 예약"이 아니라 "그 사용자의 가장 최근 예약"(대여 정보 확인
   목적) — 그 사용자에게 예약이 하나도 없으면 NULL(프론트에서 링크 비활성 처리).';

-- ROLLBACK: migration 300의 함수 본문(user_id만 반환하는 버전)으로 CREATE OR REPLACE
