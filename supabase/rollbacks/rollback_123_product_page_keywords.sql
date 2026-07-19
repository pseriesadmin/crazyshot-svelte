-- Rollback: Migration #123 — product_page_keywords
-- 적용 대상: Stage(ezyvffjvuwmtuhpxdjrw) / Production(vnbpmvxruyciuuaermyh)
-- 실행 전 주의: get_product_page_settings / upsert_product_page_setting 사용 중인지 확인

-- 1. cms_settings에서 product_page_keywords 키 제거
DELETE FROM cms_settings WHERE key = 'product_page_keywords';

-- 2. upsert_product_page_setting — product_page_keywords 허용 키 제거 (이전 버전으로 교체)
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

-- 3. get_product_page_settings — product_page_keywords 제외 (이전 버전으로 교체)
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
