-- Migration #391: get_products_by_ids RPC — option_only=true 상품 제외
-- 배경: 헤더 히어로 슬라이드·MD픽·홈 카테고리 큐레이션·하이프팩 배너 보강 등에서 재사용되는
--   이 RPC에 Migration #389의 option_only 필터를 추가한다.

CREATE OR REPLACE FUNCTION public.get_products_by_ids(p_ids UUID[])
RETURNS TABLE (
  id              UUID,
  name            TEXT,
  slug            TEXT,
  category        TEXT,
  image_urls      JSONB,
  base_price_daily INTEGER,
  product_caption TEXT,
  is_active       BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.name,
    p.slug,
    p.category::text,
    p.image_urls,
    COALESCE(p.base_price_daily, 0)::integer,
    p.product_caption,
    p.is_active
  FROM products p
  WHERE p.id = ANY(p_ids)
    AND p.deleted_at IS NULL
    AND p.is_active = true
    AND p.option_only = false;
$$;

GRANT EXECUTE ON FUNCTION public.get_products_by_ids(UUID[]) TO anon, authenticated;

-- ============================================================
-- ROLLBACK (역순 실행)
-- ============================================================
-- Migration #118의 CREATE 문 재실행으로 복구(option_only 조건 제거)
-- ============================================================
