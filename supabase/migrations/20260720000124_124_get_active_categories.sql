-- Migration 124: get_active_categories
-- product_category_codes (RLS: cms only) 를 공개 조회할 수 있는 SECURITY DEFINER RPC
-- 의존: migration 41 (product_category_codes), migration 34 (is_cms_user)

CREATE OR REPLACE FUNCTION public.get_active_categories()
RETURNS TABLE (
  id           UUID,
  code         TEXT,
  category_key TEXT,
  name         TEXT,
  sort_order   INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    id,
    code::TEXT,
    product_category AS category_key,
    name,
    sort_order
  FROM product_category_codes
  WHERE is_active = true
    AND deleted_at IS NULL
    AND depth = 0
    AND product_category IS NOT NULL
  ORDER BY sort_order ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_categories() TO anon, authenticated;
