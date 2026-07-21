-- Migration #130: 대여설정 항목 실제 상품 참조 체크 RPC 업데이트
-- products.allowed_period_ids / allowed_method_ids / allowed_pickup_ids (UUID[]) 기반 실제 조회

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
  RETURN EXISTS (
    SELECT 1 FROM products
    WHERE allowed_period_ids @> ARRAY[p_id]
      AND deleted_at IS NULL
  );
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
  RETURN EXISTS (
    SELECT 1 FROM products
    WHERE allowed_method_ids @> ARRAY[p_id]
      AND deleted_at IS NULL
  );
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
  RETURN EXISTS (
    SELECT 1 FROM products
    WHERE allowed_pickup_ids @> ARRAY[p_id]
      AND deleted_at IS NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_rental_period_option_in_use(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_rental_method_option_in_use(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_pickup_point_in_use(UUID) TO authenticated;

-- ROLLBACK:
-- Migration #129의 FALSE 반환 버전으로 복원:
-- CREATE OR REPLACE FUNCTION public.check_rental_period_option_in_use(p_id UUID) RETURNS BOOLEAN ... RETURN FALSE;
-- (동일 패턴 3종)
