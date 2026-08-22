-- Migration #325: home_category_products cms_settings 키 — upsert 화이트리스트 + RLS 정책 추가
--
-- 변경 내용:
--   1. upsert_product_page_setting 화이트리스트에 'home_category_products' 추가
--   2. cms_settings 공개읽기 RLS 정책에 'home_category_products' 추가
--
-- 주의: 이 파일은 SQL 작성 전용. Stage/Production 적용은 메인 세션(MCP)에서 별도 수행.
--
-- home_category_products 값 구조:
--   { items: [ { category_id: uuid, products: [{id: uuid, order: int}], mode: 'random'|'fixed' } ] }
-- 단순 JSONB 저장이므로 DB 단에서 구조 검증 없음.

-- ─── 1. upsert_product_page_setting: home_category_products 화이트리스트 추가 ────
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

GRANT EXECUTE ON FUNCTION public.upsert_product_page_setting(TEXT, JSONB) TO authenticated;

-- ─── 2. cms_settings 공개읽기 RLS: home_category_products 추가 ─────────────────
DROP POLICY IF EXISTS "cms_settings: public read display keys" ON public.cms_settings;

CREATE POLICY "cms_settings: public read display keys" ON public.cms_settings
  FOR SELECT
  TO anon, authenticated
  USING (
    key IN (
      'product_page_hero',
      'product_page_categories',
      'product_page_grid',
      'product_page_md_picks',
      'product_page_keywords',
      'crazylog_head_keywords',
      'crazylog_banner_slot1',
      'crazylog_banner_slot2',
      'crazylog_banner_slot3',
      'help_hero_bg_images',
      'hype_pack_banner',
      'members_hero_banner',
      'home_hero_banner_settings',
      'home_category_products'
    )
  );
