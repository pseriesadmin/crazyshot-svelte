-- Migration 118: product_page_settings
-- cms_settings 테이블에 /products 페이지 구성 설정 키 4종 추가
-- 의존: cms_settings 테이블 (migration 41), is_cms_user() (migration 34)

-- 1. 기본값 삽입 (이미 존재하면 무시)
INSERT INTO cms_settings (key, value) VALUES
  ('product_page_hero',       '{"products":[],"mode":"fixed"}'::jsonb),
  ('product_page_categories', '{"items":[]}'::jsonb),
  ('product_page_grid',       '{"category":"all","count":16,"sort":"latest"}'::jsonb),
  ('product_page_md_picks',   '{"products":[],"mode":"fixed"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 2. 페이지 설정 전체 조회 RPC (anon 허용 — 페이지 SSR에서 사용)
CREATE OR REPLACE FUNCTION public.get_product_page_settings()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
  FROM cms_settings
  WHERE key IN (
    'product_page_hero',
    'product_page_categories',
    'product_page_grid',
    'product_page_md_picks'
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_product_page_settings() TO anon, authenticated;

-- 3. 설정 저장 RPC (CMS 유저 전용)
CREATE OR REPLACE FUNCTION public.upsert_product_page_setting(
  p_key TEXT,
  p_value JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'unauthorized: cms role required';
  END IF;

  IF p_key NOT IN (
    'product_page_hero',
    'product_page_categories',
    'product_page_grid',
    'product_page_md_picks'
  ) THEN
    RAISE EXCEPTION 'invalid key: %', p_key;
  END IF;

  INSERT INTO cms_settings (key, value, updated_at)
  VALUES (p_key, p_value, now())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_product_page_setting(TEXT, JSONB) TO authenticated;

-- 4. ID 배열로 상품 조회 RPC (헤더 슬라이드·MD픽용, anon 허용)
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
    AND p.is_active = true;
$$;

GRANT EXECUTE ON FUNCTION public.get_products_by_ids(UUID[]) TO anon, authenticated;
