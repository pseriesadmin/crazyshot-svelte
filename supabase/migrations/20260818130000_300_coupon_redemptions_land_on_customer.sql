-- Migration 300: get_coupon_redemptions — 랜딩 대상을 "예약"에서 "고객"으로 전환
-- 배경: Stephen 확정(2026-08-18) — 사용 채번 목록 행 클릭 시 랜딩 목적은 "이 코드가 정확히
--   어느 예약에 쓰였는지"가 아니라 "이 쿠폰을 쓴 고객의 대여 정보를 확인"하는 것이었다.
--   이전 설계(order_id → order_items → 대표 예약 1건, migration 297/298)는 한 체크아웃에
--   여러 예약이 묶이는 N:1 구조 때문에 "대표"를 임의로 골라야 하는 불안정한 설계였는데,
--   user_coupons.user_id는 항상 정확히 1명을 가리키는 안전한 값이라 이걸로 대체하면
--   여러 쿠폰을 중복 사용한 경우에도 항상 정확히 해당 사용자로 랜딩된다.
--   랜딩 대상은 CustomerDetailPanel(/cms/customers?selected=<user_id>, get_customer_list
--   RPC의 p_user_id 단건 재조회 패턴 — /cms/customers/+page.server.ts:54,69와 동일 관례).
-- 변경: order_items/rental_reservations LEFT JOIN 전부 제거, user_id를 직접 반환.
--   reservation_id/reservation_status 컬럼 삭제(반환 타입 변경).
-- 2026-08-18

DROP FUNCTION IF EXISTS public.get_coupon_redemptions(UUID);

CREATE OR REPLACE FUNCTION public.get_coupon_redemptions(p_coupon_id UUID)
RETURNS TABLE(
  user_coupon_id  UUID,
  user_id         UUID,
  redeemed_code   TEXT,
  used_at         TIMESTAMPTZ,
  user_name       TEXT,
  user_email      TEXT
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
    up.email
  FROM user_coupons uc
  LEFT JOIN user_profiles up ON up.id = uc.user_id
  WHERE uc.coupon_id = p_coupon_id
    AND uc.used_at IS NOT NULL
  ORDER BY uc.used_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_coupon_redemptions(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_coupon_redemptions(UUID) TO service_role;

COMMENT ON FUNCTION public.get_coupon_redemptions(UUID) IS
  'CMS 쿠폰 관리 화면 "사용 채번 목록" 전용. manual/sequenced 모드 구분 없이 실제 사용
   (used_at IS NOT NULL)된 이력을 반환하며, 각 행의 user_id로 /cms/customers?selected=
   <user_id>(CustomerDetailPanel)로 랜딩한다 — 예약 단위가 아니라 항상 정확한 1명의
   고객으로 연결(중복 쿠폰 사용 케이스에도 안정적).';

-- ROLLBACK: migration 299의 함수 본문(예약 조인 포함 버전)으로 CREATE OR REPLACE
