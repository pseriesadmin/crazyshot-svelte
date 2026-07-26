-- Migration #161: get_product_option_links RPC image_url 따옴표 버그 수정
-- 원인: image_urls 컬럼이 JSONB 타입인데 [1] 접근 시 JSONB 문자열 "url" 반환 (따옴표 포함)
-- 수정: ->>0 연산자 (JSONB text 추출 — 따옴표 없음, 0-indexed)

CREATE OR REPLACE FUNCTION get_product_option_links(p_product_id UUID)
RETURNS TABLE(
  link_id                  UUID,
  option_product_id        UUID,
  option_product_name      TEXT,
  price_24h                NUMERIC,
  stock_quantity           INT,
  is_required              BOOLEAN,
  min_select_required      BOOLEAN,
  delivery_rental_disabled BOOLEAN,
  display_order            SMALLINT,
  image_url                TEXT
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    pol.id                   AS link_id,
    pol.option_product_id,
    p.name                   AS option_product_name,
    pr.price                 AS price_24h,
    p.stock_quantity,
    pol.is_required,
    pol.min_select_required,
    pol.delivery_rental_disabled,
    pol.display_order,
    p.image_urls->>0         AS image_url   -- JSONB text 추출 (따옴표 없음)
  FROM product_option_links pol
  JOIN products p ON p.id = pol.option_product_id AND p.deleted_at IS NULL
  LEFT JOIN price_rules pr
    ON pr.product_id = pol.option_product_id
    AND pr.duration_type = '24h'
    AND pr.is_active = true
    AND pr.deleted_at IS NULL
  WHERE pol.product_id = p_product_id
    AND pol.deleted_at IS NULL
  ORDER BY pol.display_order ASC;
$$;
