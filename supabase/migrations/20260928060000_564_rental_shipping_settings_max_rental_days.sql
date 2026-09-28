-- Migration #564: rental_shipping_settings — 최대 대여일수(max_rental_days) 신규 컬럼 추가
-- 기본값 15일. CMS `/cms/set/rental` "배송 설정" 섹션에서 관리자가 조정 가능.
-- 장바구니(cart/+page.svelte) 반납일 CalendarGrid의 maxDate를 수령일 + max_rental_days 로 제한해
-- 고객이 선택할 수 있는 반납일 상한을 관리자 설정값과 일치시킨다.

-- ─── 1. 컬럼 추가 ───
ALTER TABLE rental_shipping_settings
  ADD COLUMN IF NOT EXISTS max_rental_days INTEGER NOT NULL DEFAULT 15;

-- ─── 2. 기존 7-param 함수 제거 후 8-param 함수 재생성 ───
-- PostgreSQL에서 파라미터 수 변경은 CREATE OR REPLACE로 불가 → DROP 후 재생성.
-- p_max_rental_days에 DEFAULT 15 부여: 기존 7-param 호출(named params)이 그대로 동작하며
-- 8번째 파라미터는 DEFAULT 값으로 채워진다.

DROP FUNCTION IF EXISTS public.upsert_rental_shipping_settings(BOOLEAN, INTEGER, BOOLEAN, INTEGER, BOOLEAN, INTEGER, VARCHAR);

CREATE OR REPLACE FUNCTION public.upsert_rental_shipping_settings(
  p_enable_round_trip BOOLEAN,
  p_round_trip_fee    INTEGER,
  p_enable_delivery   BOOLEAN,
  p_delivery_fee      INTEGER,
  p_enable_return     BOOLEAN,
  p_return_fee        INTEGER,
  p_shipping_guide    VARCHAR,
  p_max_rental_days   INTEGER DEFAULT 15
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_cms_user() THEN
    RAISE EXCEPTION 'CMS 권한이 필요합니다.';
  END IF;

  UPDATE rental_shipping_settings SET
    enable_round_trip = p_enable_round_trip,
    round_trip_fee    = p_round_trip_fee,
    enable_delivery   = p_enable_delivery,
    delivery_fee      = p_delivery_fee,
    enable_return     = p_enable_return,
    return_fee        = p_return_fee,
    shipping_guide    = p_shipping_guide,
    max_rental_days   = p_max_rental_days,
    updated_at        = now()
  WHERE true;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_rental_shipping_settings(BOOLEAN, INTEGER, BOOLEAN, INTEGER, BOOLEAN, INTEGER, VARCHAR, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_rental_shipping_settings(BOOLEAN, INTEGER, BOOLEAN, INTEGER, BOOLEAN, INTEGER, VARCHAR, INTEGER) TO authenticated;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP FUNCTION public.upsert_rental_shipping_settings(BOOLEAN, INTEGER, BOOLEAN, INTEGER, BOOLEAN, INTEGER, VARCHAR, INTEGER);
-- 기존 Migration #523 원본 재실행.
-- ALTER TABLE rental_shipping_settings DROP COLUMN IF EXISTS max_rental_days;
-- ============================================================
