-- Migration #304: get_user_rental_stats에 cancelled_count 추가
-- 목적: /account 페이지 "취소·반품" 배지가 항상 하드코딩 0으로 표시되던 문제 수정
-- (프론트 rentalStats.cancelled: 0 고정값이었으나, RPC 자체에 취소 건수 컬럼이 없어서
--  실제로는 프론트에서 채울 값이 없었음 — RPC 반환 컬럼 추가로 근본 해결)

DROP FUNCTION IF EXISTS public.get_user_rental_stats(UUID);

CREATE FUNCTION public.get_user_rental_stats(
  p_user_id UUID
)
RETURNS TABLE(
  total_count     BIGINT,
  active_count    BIGINT,
  shipping_count  BIGINT,
  done_count      BIGINT,
  cancelled_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- service_role 호출 시 auth.uid() = NULL → 스킵
  IF auth.uid() IS NOT NULL AND p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE status NOT IN ('hold', 'cancelled'))::BIGINT AS total_count,
    COUNT(*) FILTER (WHERE status = 'in_use')::BIGINT                  AS active_count,
    COUNT(*) FILTER (WHERE status = 'shipped')::BIGINT                 AS shipping_count,
    COUNT(*) FILTER (WHERE status IN ('returned', 'completed'))::BIGINT AS done_count,
    COUNT(*) FILTER (WHERE status = 'cancelled')::BIGINT               AS cancelled_count
  FROM rental_reservations
  WHERE user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_rental_stats(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_rental_stats(UUID) TO authenticated;
