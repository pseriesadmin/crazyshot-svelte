-- migration #576: get_most_viewed_products RPC
-- /products 상품 목록(Best Pick) 노출 기준 — 상품 상세 조회수(가장 많이 본 상품) 내림차순
--
-- 데이터 소스: user_behavior_events (event_type='click', event_data->>'action'='product_view',
--             event_data->>'product_id') — behaviorTracker.trackProductView()가 기록
-- 공개 조건: search_products와 동일(삭제 안 됨 · 부모 상품 · option_only=false · is_active=true)
-- 정렬: 조회수 DESC → 동률·무조회 상품은 최신 등록순(created_at DESC)
-- p_days NULL = 전체 기간

CREATE OR REPLACE FUNCTION get_most_viewed_products(
  p_category TEXT DEFAULT NULL,
  p_limit    INT  DEFAULT 16,
  p_days     INT  DEFAULT NULL
)
RETURNS TABLE (
  product_id       UUID,
  name             TEXT,
  slug             TEXT,
  category         TEXT,
  image_urls       JSONB,
  base_price_daily NUMERIC,
  product_caption  TEXT,
  is_active        BOOLEAN,
  view_count       BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH views AS (
    SELECT e.event_data->>'product_id' AS pid, count(*) AS cnt
    FROM user_behavior_events e
    WHERE e.event_type = 'click'
      AND e.event_data->>'action' = 'product_view'
      AND e.event_data->>'product_id' IS NOT NULL
      AND (p_days IS NULL OR e.created_at >= now() - make_interval(days => p_days))
    GROUP BY e.event_data->>'product_id'
  )
  SELECT
    p.id,
    p.name,
    p.slug,
    p.category::text,
    to_jsonb(p.image_urls),
    p.base_price_daily,
    p.product_caption,
    p.is_active,
    coalesce(v.cnt, 0)::bigint
  FROM products p
  LEFT JOIN views v ON v.pid = p.id::text
  WHERE p.deleted_at IS NULL
    AND p.parent_product_id IS NULL
    AND p.option_only = false
    AND p.is_active = true
    AND (p_category IS NULL OR p.category::text = p_category)
  ORDER BY coalesce(v.cnt, 0) DESC, p.created_at DESC
  LIMIT greatest(p_limit, 1);
$$;

GRANT EXECUTE ON FUNCTION get_most_viewed_products(TEXT, INT, INT) TO anon, authenticated;

-- ROLLBACK:
-- REVOKE EXECUTE ON FUNCTION get_most_viewed_products(TEXT, INT, INT) FROM anon, authenticated;
-- DROP FUNCTION IF EXISTS get_most_viewed_products(TEXT, INT, INT);
