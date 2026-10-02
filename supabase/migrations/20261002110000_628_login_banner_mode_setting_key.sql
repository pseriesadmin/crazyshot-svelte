-- migration #628: 로그인 화면 배너 설정 키(login_banner_mode) — upsert 화이트리스트 + 공개 읽기 정책
--
-- 배경: 로그인 배너 관리 모달(LoginBannerModal)이 노출 방식을 cms_settings.login_banner_mode 에 저장하려 했지만
--   ① upsert_product_page_setting 화이트리스트에 키가 없어 'invalid key'로 저장이 실패했고(배너 저장 후 설정 단계에서 실패),
--   ② 비로그인 방문자가 보는 로그인 화면이 읽을 수 있도록 공개 읽기 정책에도 키가 없었다.
--
-- 값 구조: { pc_mode: 'fixed'|'random', mobile_mode: 'fixed'|'random', mobile_visible: boolean }
--   mobile_visible=false 이면 모바일 로그인 화면에서 배너 영역 전체를 숨긴다(키·값이 없으면 노출 = 기존 동작).
--   단순 JSONB 저장 — DB 단 구조 검증 없음.
--
-- 기존 키·권한(GRANT)은 CREATE OR REPLACE 로 그대로 유지. 본문은 Stage·Production 동일 해시(85714696…) 확인 후
-- login_banner_mode 한 줄만 추가했다.

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
    'home_category_products',
    'login_banner_mode'
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

-- 공개 읽기 정책: login_banner_mode 추가(기존 키 전부 유지)
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
      'home_category_products',
      'login_banner_mode'
    )
  );

-- ─── ROLLBACK (필요 시 수동 실행) ─────────────────────────────────────────────
-- 1) upsert_product_page_setting: 허용 키에서 'login_banner_mode' 한 줄만 제거한 #577 본문으로 CREATE OR REPLACE
-- 2) 정책 원복:
--   DROP POLICY IF EXISTS "cms_settings: public read display keys" ON public.cms_settings;
--   CREATE POLICY "cms_settings: public read display keys" ON public.cms_settings FOR SELECT TO anon, authenticated
--     USING (key IN ('product_page_hero','product_page_categories','product_page_grid','product_page_md_picks',
--       'product_page_keywords','crazylog_head_keywords','crazylog_banner_slot1','crazylog_banner_slot2',
--       'crazylog_banner_slot3','help_hero_bg_images','hype_pack_banner','members_hero_banner',
--       'home_hero_banner_settings','home_category_products'));
-- 3) 이미 저장된 login_banner_mode 행이 필요 없으면: DELETE FROM public.cms_settings WHERE key = 'login_banner_mode';
