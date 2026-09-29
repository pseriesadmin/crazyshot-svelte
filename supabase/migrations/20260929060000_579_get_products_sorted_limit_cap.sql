-- migration #579: get_products_sorted 조회 개수 상한(200) — #578 후속 QA 권고
-- 익명 호출자가 p_limit을 크게 넣고 views 정렬을 반복 호출해 user_behavior_events 전체 집계 비용을 키우는 것을 방지.
-- 본문은 #578과 동일하고 LIMIT 절만 least(greatest(p_limit,1), 200)로 변경.

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
  LIMIT least(greatest(p_limit, 1), 200);
$$;

GRANT EXECUTE ON FUNCTION get_products_sorted(TEXT, TEXT, INT, TEXT) TO anon, authenticated;

-- ROLLBACK: Migration #578 본문(LIMIT greatest(p_limit, 1))으로 CREATE OR REPLACE 재적용
