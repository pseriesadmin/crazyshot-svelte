-- Migration 298: get_coupon_redemptions 인증 방식 수정
-- 배경(발견된 결함, 배포 전 자체 검증 중 확인): migration 297에서 이 함수 내부에 만든
-- `is_cms_user()` 체크는 auth.uid()(호출자의 JWT)를 기준으로 판단하는데, 이 함수를 실제
-- 호출하는 지점(src/routes/api/cms/coupons/[id]/redemptions/+server.ts)은
-- `getCmsRoleForAction(locals)`로 앱 레벨에서 이미 CMS 권한을 확인한 뒤 진짜 service_role
-- 키로 만든 클라이언트를 사용한다(src/routes/api/cms/reservations/[id]/options/+server.ts와
-- 동일 패턴) — service_role 키 호출에는 auth.uid()가 채워지지 않으므로 is_cms_user()가
-- 항상 false를 반환해 모든 호출이 ACCESS_DENIED로 실패하는 구조였다.
-- 수정: 함수 내부 is_cms_user() 체크를 제거하고, generate_user_coupon_redeemed_code와
--   동일하게 REVOKE ALL + GRANT TO service_role만으로 접근 제어(앱 레벨 권한 확인은
--   getCmsRoleForAction이 이미 수행 — DB 레벨은 "service_role만 실행 가능"이면 충분).
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
    AND uc.redeemed_code IS NOT NULL
  ORDER BY uc.used_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_coupon_redemptions(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_coupon_redemptions(UUID) TO service_role;

-- ROLLBACK: is_cms_user() 체크를 되살리려면 migration 297의 함수 본문으로 CREATE OR REPLACE
