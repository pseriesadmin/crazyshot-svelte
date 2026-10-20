-- Migration 732: get_product_reviews 정의 드리프트 정렬 (Production을 Migration 124/Stage 정의로 복원)
--
-- 배경(2026-10-20 로그 점검): Production의 get_product_reviews가 Migration 124(저장소·Stage) 정의와 달랐다.
--   Production 버전은 존재하지 않는 product_reviews.deleted_at 으로 거르고 user_profiles 를 JOIN 해
--   user_id·user_name 을 반환 → 상품 상세 화면이 열릴 때마다 "column pr.deleted_at does not exist" 오류(24시간 138건),
--   화면은 오류를 숨기고 "후기 없음"으로 표시. (Production 후기 0건이라 아직 눈에 띄는 피해는 없었음)
-- 변경: 반환 컬럼이 달라 CREATE OR REPLACE 불가 → DROP 후 Migration 124 정의로 재생성, 실행 권한은 Migration 124와 동일.
--   테이블·데이터·다른 함수는 변경 없음. Stage는 이미 같은 정의라 재실행해도 결과 동일(멱등).
-- ROLLBACK(Production 이전 정의 — 이 정의는 호출마다 실패하던 상태이므로 되돌릴 실익은 없고 기록 목적. 실행하려면 `-- `를 지우고 DROP 후 실행):
-- DROP FUNCTION IF EXISTS public.get_product_reviews(uuid, integer, integer);
-- CREATE FUNCTION public.get_product_reviews(p_product_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
--  RETURNS TABLE(id uuid, user_id uuid, user_name text, title text, content text, created_at timestamp with time zone)
--  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
-- AS $function$
-- BEGIN
--   RETURN QUERY
--   SELECT pr.id, pr.user_id, up.full_name, pr.title, pr.content, pr.created_at
--   FROM product_reviews pr JOIN user_profiles up ON up.id = pr.user_id
--   WHERE pr.product_id = p_product_id AND pr.deleted_at IS NULL
--   ORDER BY pr.created_at DESC LIMIT p_limit OFFSET p_offset;
-- END;
-- $function$;

DROP FUNCTION IF EXISTS public.get_product_reviews(uuid, integer, integer);

CREATE FUNCTION public.get_product_reviews(
  p_product_id uuid,
  p_limit      integer DEFAULT 20,
  p_offset     integer DEFAULT 0
)
RETURNS TABLE(id uuid, author_name text, title text, content text, created_at timestamp with time zone)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT id, author_name, title, content, created_at
  FROM public.product_reviews
  WHERE product_id = p_product_id
    AND is_public = true
  ORDER BY created_at DESC
  LIMIT p_limit OFFSET p_offset;
$function$;

GRANT EXECUTE ON FUNCTION public.get_product_reviews(uuid, integer, integer) TO anon, authenticated;
