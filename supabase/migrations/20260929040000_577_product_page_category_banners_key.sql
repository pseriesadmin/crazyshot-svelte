-- migration #577: /products 카테고리 선택 시 노출 배너(product_page_category_banners) 설정 키 추가
--
-- 값 구조: { items: [ { category_id: text, image_url: text|null, link_url: text|null, alt: text, enabled: bool } ] }
-- 단순 JSONB 저장 — DB 단 구조 검증 없음. 기존 키·권한(GRANT)은 CREATE OR REPLACE로 그대로 유지.

CREATE OR REPLACE FUNCTION public.upsert_product_page_setting(
  p_key   TEXT,
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
    'product_page_md_picks',
    'product_page_keywords',
    'product_page_category_banners',
    'crazylog_head_keywords',
    'help_hero_bg_images',
    'hype_pack_banner',
    'members_hero_banner',
    'home_hero_banner_settings',
    'home_category_products'
  ) THEN
    RAISE EXCEPTION 'invalid key: %', p_key;
  END IF;

  INSERT INTO cms_settings (key, value, updated_at)
  VALUES (p_key, p_value, now())
  ON CONFLICT (key) DO UPDATE
    SET value      = EXCLUDED.value,
        updated_at = now();
END;
$$;

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
    'product_page_md_picks',
    'product_page_keywords',
    'product_page_category_banners'
  );
$$;

-- ROLLBACK (이전 정의 = Migration #325 기준으로 복원 — product_page_category_banners 키만 제거):
-- CREATE OR REPLACE FUNCTION public.upsert_product_page_setting(p_key TEXT, p_value JSONB)
-- RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- BEGIN
--   IF NOT public.is_cms_user() THEN RAISE EXCEPTION 'unauthorized: cms role required'; END IF;
--   IF p_key NOT IN ('product_page_hero','product_page_categories','product_page_grid','product_page_md_picks',
--     'product_page_keywords','crazylog_head_keywords','help_hero_bg_images','hype_pack_banner','members_hero_banner',
--     'home_hero_banner_settings','home_category_products') THEN RAISE EXCEPTION 'invalid key: %', p_key; END IF;
--   INSERT INTO cms_settings (key, value, updated_at) VALUES (p_key, p_value, now())
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
-- END; $$;
-- CREATE OR REPLACE FUNCTION public.get_product_page_settings() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
-- SET search_path = public AS $$
--   SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) FROM cms_settings
--   WHERE key IN ('product_page_hero','product_page_categories','product_page_grid','product_page_md_picks','product_page_keywords');
-- $$;
