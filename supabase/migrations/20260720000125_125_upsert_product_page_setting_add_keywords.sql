-- migration #125: upsert_product_page_setting 허용 키에 product_page_keywords 추가
-- 원인: Production에 stage의 123_product_page_keywords_v2가 미적용 상태.
--       허용 키 목록에 product_page_keywords가 없어 키워드 저장 시 'invalid key' 에러 발생.

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
