-- migration #578: get_products_sorted RPC
-- /products 상품 목록 "노출 순서"(product_page_grid.sort) 연동 — latest / random / views / rentals
--
-- 공개 조건: get_most_viewed_products(#576)·search_products와 동일
--   (삭제 안 됨 · 부모 상품 · option_only=false · is_active=true)
-- 정렬:
--   latest  : created_at DESC
--   random  : md5(id || p_seed) — 같은 p_seed면 항상 같은 순서(무한스크롤 재조회 시 순서 유지)
--   views   : 상품 상세 조회수 DESC (동률 최신순)
--   rentals : 렌탈 완료·진행 건수 DESC (동률 최신순). 재고단위(자식) 예약은 부모 기준으로 합산.
--             집계 상태: confirmed / shipped / in_use / return_requested / returned / completed
-- 알 수 없는 p_sort 값은 views로 처리.

CREATE OR REPLACE FUNCTION get_products_sorted(
  p_category TEXT DEFAULT NULL,
  p_sort     TEXT DEFAULT 'views',
  p_limit    INT  DEFAULT 16,
  p_seed     TEXT DEFAULT ''
)
RETURNS TABLE (
  product_id       UUID,
  name             TEXT,
  slug             TEXT,
  category         TEXT,
  image_urls       JSONB,
  base_price_daily NUMERIC,
  product_caption  TEXT,
  is_active        BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH views AS (
    SELECT e.event_data->>'product_id' AS pid, count(*) AS cnt
    FROM user_behavior_events e
    WHERE p_sort NOT IN ('latest', 'random', 'rentals')
      AND e.event_type = 'click'
      AND e.event_data->>'action' = 'product_view'
      AND e.event_data->>'product_id' IS NOT NULL
    GROUP BY e.event_data->>'product_id'
  ),
  rentals AS (
    SELECT coalesce(pc.parent_product_id, pc.id) AS pid, count(*) AS cnt
    FROM rental_reservations r
    JOIN products pc ON pc.id = r.product_id
    WHERE p_sort = 'rentals'
      AND r.status::text IN ('confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed')
    GROUP BY coalesce(pc.parent_product_id, pc.id)
  )
  SELECT
    p.id,
    p.name,
    p.slug,
    p.category::text,
    to_jsonb(p.image_urls),
    p.base_price_daily,
    p.product_caption,
    p.is_active
  FROM products p
  LEFT JOIN views   v ON v.pid = p.id::text
  LEFT JOIN rentals rn ON rn.pid = p.id
  WHERE p.deleted_at IS NULL
    AND p.parent_product_id IS NULL
    AND p.option_only = false
    AND p.is_active = true
    AND (p_category IS NULL OR p.category::text = p_category)
  ORDER BY
    (CASE WHEN p_sort = 'rentals' THEN coalesce(rn.cnt, 0)
          WHEN p_sort IN ('latest', 'random') THEN 0
          ELSE coalesce(v.cnt, 0) END) DESC,
    (CASE WHEN p_sort = 'random' THEN md5(p.id::text || coalesce(p_seed, '')) END) ASC,
    p.created_at DESC
  LIMIT greatest(p_limit, 1);
$$;

GRANT EXECUTE ON FUNCTION get_products_sorted(TEXT, TEXT, INT, TEXT) TO anon, authenticated;

-- ROLLBACK:
-- REVOKE EXECUTE ON FUNCTION get_products_sorted(TEXT, TEXT, INT, TEXT) FROM anon, authenticated;
-- DROP FUNCTION IF EXISTS get_products_sorted(TEXT, TEXT, INT, TEXT);
