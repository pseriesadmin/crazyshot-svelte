-- Migration #318: 홈 히어로 배너 sub_copy 컬럼 + cms 관리 기능 신설
--
-- 변경 내용:
--   1. banners.sub_copy TEXT 컬럼 추가
--   2. cms_create_banner 재생성 (p_sub_copy 파라미터 + MAX-10 가드)
--   3. cms_update_banner 신규 RPC
--   4. upsert_product_page_setting 화이트리스트에 home_hero_banner_settings 추가
--   5. cms_settings 공개읽기 RLS 정책에 home_hero_banner_settings 추가
--
-- 주의: 이 파일은 SQL 작성 전용. Stage/Production 적용은 메인 세션(MCP)에서 별도 수행.

-- ─── 1. banners.sub_copy 컬럼 추가 ────────────────────────────────────────────
ALTER TABLE public.banners
  ADD COLUMN IF NOT EXISTS sub_copy TEXT;

-- ─── 2. cms_create_banner 재생성 (기존 8-param DROP 후 9-param 재생성) ─────────
--    기존 시그니처(migration 262): (TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ)
DROP FUNCTION IF EXISTS public.cms_create_banner(TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.cms_create_banner(
  p_slot_key    TEXT,
  p_title       TEXT,
  p_sub_copy    TEXT          DEFAULT NULL,
  p_image_url   TEXT          DEFAULT NULL,
  p_link_url    TEXT          DEFAULT NULL,
  p_device_type TEXT          DEFAULT 'all',
  p_sort_order  INTEGER       DEFAULT 0,
  p_valid_from  TIMESTAMPTZ   DEFAULT NULL,
  p_valid_until TIMESTAMPTZ   DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count  INTEGER;
  v_new_id UUID;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  -- MAX-10 가드: slot_key 기준 활성 배너 상한
  SELECT COUNT(*) INTO v_count
    FROM public.banners
   WHERE slot_key = p_slot_key
     AND deleted_at IS NULL;

  IF v_count >= 10 THEN
    RAISE EXCEPTION 'MAX_10_BANNERS';
  END IF;

  INSERT INTO public.banners (
    slot_key, title, sub_copy, image_url, link_url,
    device_type, sort_order, valid_from, valid_until, is_active
  )
  VALUES (
    p_slot_key, p_title, p_sub_copy, p_image_url, p_link_url,
    p_device_type, p_sort_order, p_valid_from, p_valid_until, true
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('ok', true, 'id', v_new_id);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cms_create_banner(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ─── 3. cms_update_banner 신규 RPC ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cms_update_banner(
  p_id          UUID,
  p_title       TEXT,
  p_sub_copy    TEXT          DEFAULT NULL,
  p_image_url   TEXT          DEFAULT NULL,
  p_link_url    TEXT          DEFAULT NULL,
  p_sort_order  INTEGER       DEFAULT 0,
  p_valid_from  TIMESTAMPTZ   DEFAULT NULL,
  p_valid_until TIMESTAMPTZ   DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  UPDATE public.banners
     SET title       = p_title,
         sub_copy    = p_sub_copy,
         image_url   = COALESCE(p_image_url, image_url),
         link_url    = p_link_url,
         sort_order  = p_sort_order,
         valid_from  = p_valid_from,
         valid_until = p_valid_until
   WHERE id = p_id
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BANNER_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cms_update_banner(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ─── 4. upsert_product_page_setting: home_hero_banner_settings 화이트리스트 추가 ──
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
    'home_hero_banner_settings'
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

-- ─── 5. cms_settings 공개읽기 RLS: home_hero_banner_settings 추가 ──────────────
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
      'home_hero_banner_settings'
    )
  );
