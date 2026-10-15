-- migration #715: /members 하단 "정기구독 이용안내" 영역 배경 사진 2장(상단·하단) 교체 설정 키(members_benefits_photos)
--   — upsert 화이트리스트 + 공개 읽기 정책
--
-- 배경: /members PC 반응형의 이용안내 영역(CommonBenefits) 배경 사진 2장을 관리자가 front 관리모달에서 교체·초점 조정할 수 있게 한다.
--   ① upsert_product_page_setting 화이트리스트에 키가 없으면 저장이 'invalid key'로 실패하고,
--   ② 비로그인 방문자가 보는 /members가 읽을 수 있도록 공개 읽기 정책에도 키가 필요하다(#628 login_banner_mode와 동일한 이유).
--
-- 값 구조(JSONB, DB 단 구조 검증 없음 — 앱이 정규화):
--   { top:    { url, path, x, y } | null,
--     bottom: { url, path, x, y } | null }
--   url·path: 업로드한 이미지(공개 URL·스토리지 경로), null 이면 기본 사진(/members/benefits-photo1.png·benefits-photo2.png) 사용
--   x·y: 초점 위치(0~100 %, object-position) — PC·모바일 양쪽 표시 영역 비율에 같은 값으로 적용
--   키·값이 없으면 기존 동작(기본 사진·기본 초점).
--
-- 기존 키·권한(GRANT)은 CREATE OR REPLACE 로 그대로 유지. 본문은 Stage·Production 동일 해시(db83c3a3…) 확인 후
-- members_benefits_photos 한 줄만 추가했다(정책도 Stage·Production 동일 해시 7a122e66… 확인 후 한 줄만 추가).

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
    'members_benefits_photos'
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

-- 공개 읽기 정책: members_benefits_photos 추가(기존 키 전부 유지)
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
      'members_benefits_photos'
    )
  );

-- ─── ROLLBACK (필요 시 수동 실행) ─────────────────────────────────────────────
-- 1) upsert_product_page_setting: 허용 키에서 'members_benefits_photos' 한 줄만 제거한 #628 본문으로 CREATE OR REPLACE
-- 2) 정책 원복:
--   DROP POLICY IF EXISTS "cms_settings: public read display keys" ON public.cms_settings;
--   CREATE POLICY "cms_settings: public read display keys" ON public.cms_settings FOR SELECT TO anon, authenticated
--     USING (key IN ('product_page_hero','product_page_categories','product_page_grid','product_page_md_picks',
--       'product_page_keywords','crazylog_head_keywords','crazylog_banner_slot1','crazylog_banner_slot2',
--       'crazylog_banner_slot3','help_hero_bg_images','hype_pack_banner','members_hero_banner',
--       'home_hero_banner_settings','home_category_products','login_banner_mode'));
-- 3) 이미 저장된 members_benefits_photos 행이 필요 없으면: DELETE FROM public.cms_settings WHERE key = 'members_benefits_photos';
