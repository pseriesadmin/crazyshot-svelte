-- migration 123: 상품 페이지 키워드 설정 추가
-- 1) cms_settings 기본값 추가
-- 2) get_product_page_settings() 함수에 product_page_keywords 키 포함

INSERT INTO cms_settings (key, value)
VALUES ('product_page_keywords', '{"items": []}')
ON CONFLICT (key) DO NOTHING;

-- upsert_product_page_setting: 허용 키 목록에 product_page_keywords 추가
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
    'product_page_md_picks',
    'product_page_keywords'
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

-- get_product_page_settings: product_page_keywords 키 추가
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
    'product_page_keywords'
  );
$$;
