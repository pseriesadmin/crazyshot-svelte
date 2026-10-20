-- Migration 734: get_product_reviews 한 번에 가져오는 후기 수에 상한(50) 추가
--
-- 배경(2026-10-20 sp3 검수 MINOR): 비로그인 사용자도 호출할 수 있는 함수인데 p_limit에 상한이 없어
--   p_limit에 아주 큰 값을 넣어 호출할 수 있었다(공개 후기만 반환하므로 노출 위험은 작지만 부하·남용 여지).
-- 변경: 시그니처·반환 컬럼·권한은 그대로(CREATE OR REPLACE), LIMIT만 1~50으로 제한, OFFSET은 0 이상으로 보정.
--   앱 호출부(src/routes/products/[id]/+page.server.ts)는 p_limit을 넘기지 않아 기본값 20이 그대로 적용된다.
-- ROLLBACK(실행 가능 — `-- `를 지우고 실행하면 Migration 732 정의로 복원, LIMIT/OFFSET 한 줄만 다름):
-- CREATE OR REPLACE FUNCTION public.get_product_reviews(p_product_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
--  RETURNS TABLE(id uuid, author_name text, title text, content text, created_at timestamp with time zone)
--  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
-- AS $function$
--   SELECT id, author_name, title, content, created_at
--   FROM public.product_reviews
--   WHERE product_id = p_product_id AND is_public = true
--   ORDER BY created_at DESC
--   LIMIT p_limit OFFSET p_offset;
-- $function$;

CREATE OR REPLACE FUNCTION public.get_product_reviews(
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
  LIMIT least(greatest(coalesce(p_limit, 20), 1), 50) OFFSET greatest(coalesce(p_offset, 0), 0);
$function$;
