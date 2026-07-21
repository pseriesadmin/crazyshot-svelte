-- Migration #129: 대여설정 항목 상품 참조 여부 체크 RPC
-- 현재: 상품-옵션 링킹 테이블 미구현 → 항상 FALSE 반환
-- 추후: 링킹 테이블 구현 시 본 함수 내부 로직을 신규 마이그레이션으로 업데이트

CREATE OR REPLACE FUNCTION public.check_rental_period_option_in_use(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'unauthorized: cms role required';
  END IF;
  -- TODO: 상품-대여기간 링킹 구현 후 실제 참조 조회로 교체
  -- RETURN EXISTS (SELECT 1 FROM product_rental_period_links WHERE rental_period_option_id = p_id AND deleted_at IS NULL);
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_rental_method_option_in_use(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'unauthorized: cms role required';
  END IF;
  -- TODO: 상품-대여방식 링킹 구현 후 실제 참조 조회로 교체
  -- RETURN EXISTS (SELECT 1 FROM product_rental_method_links WHERE rental_method_option_id = p_id AND deleted_at IS NULL);
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_pickup_point_in_use(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'unauthorized: cms role required';
  END IF;
  -- TODO: 상품-지점 링킹 구현 후 실제 참조 조회로 교체
  -- RETURN EXISTS (SELECT 1 FROM product_pickup_point_links WHERE pickup_point_id = p_id AND deleted_at IS NULL);
  RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_rental_period_option_in_use(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_rental_method_option_in_use(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_pickup_point_in_use(UUID) TO authenticated;

-- ROLLBACK:
-- DROP FUNCTION IF EXISTS public.check_rental_period_option_in_use(UUID);
-- DROP FUNCTION IF EXISTS public.check_rental_method_option_in_use(UUID);
-- DROP FUNCTION IF EXISTS public.check_pickup_point_in_use(UUID);
