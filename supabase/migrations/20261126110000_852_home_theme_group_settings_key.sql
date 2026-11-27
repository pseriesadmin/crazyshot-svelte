-- migration #852: 홈 '취향직격 테마그룹' 우선노출 설정 키(home_theme_group_settings)
--   — upsert 화이트리스트 + 공개 읽기 정책
--
-- 배경: 홈 화면 설정 모달의 테마그룹 카드에 '우선노출지정'을 둔다 — 지정한 그룹이 홈의 테마 탭에서 맨 앞(먼저 열림)에 온다.
--   ① upsert_product_page_setting 화이트리스트에 키가 없으면 저장이 'invalid key'로 실패하고,
--   ② 비로그인 방문자가 보는 홈이 읽을 수 있도록 공개 읽기 정책에도 키가 필요하다(#848 gnb_badge_banner 와 같은 이유).
--
-- 값 구조(JSONB, DB 단 구조 검증 없음 — 앱이 읽을 때 정규화): { first_id: '<theme_group id>' | null }
--   키·값이 없으면 기존 동작(정렬 순서 그대로).
--
-- 기존 키·권한(GRANT)은 CREATE OR REPLACE 로 그대로 유지. 본문은 #848 에 home_theme_group_settings 한 줄만 추가했다.
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh)

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
    'login_banner_mode',
    'members_benefits_photos',
    'gnb_badge_banner',
    'home_theme_group_settings'
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

-- 공개 읽기 정책: home_theme_group_settings 추가(기존 키 전부 유지)
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
      'login_banner_mode',
      'members_benefits_photos',
      'gnb_badge_banner',
      'home_theme_group_settings'
    )
  );

-- ─── ROLLBACK (필요 시 수동 실행) ─────────────────────────────────────────────
-- 1) upsert_product_page_setting: 허용 키에서 'home_theme_group_settings' 한 줄만 제거한 #848 본문으로 CREATE OR REPLACE
-- 2) 정책 원복: #848 의 정책 본문(키 목록에서 'home_theme_group_settings' 제외)으로 DROP POLICY + CREATE POLICY 재실행
-- 3) 이미 저장된 행이 필요 없으면: DELETE FROM public.cms_settings WHERE key = 'home_theme_group_settings';
