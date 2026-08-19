-- migration #312: cms_settings — 페이지 표시용 배너/설정 키에 한해 anon/authenticated SELECT 허용
--
-- 배경: 관리자가 /members·/help·/hype-pack·/crazylog 히어로 배너를 업로드해도,
-- 기존 RLS("cms_settings: cms only", FOR ALL USING is_cms_user())가 anon SELECT를
-- 막고 있어 +page.server.ts(locals.supabase, 세션 컨텍스트)가 조회 시 빈 값을 받고
-- 항상 기본 이미지로 폴백되던 구조적 결함. 채번규칙(product_code_format 등) 내부설정과
-- 같은 테이블을 공유하므로 전체 공개가 아닌, upsert_product_page_setting RPC의 쓰기
-- 화이트리스트와 동일한 "페이지 표시용" 키 목록만 명시적으로 읽기 허용한다.

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
      'members_hero_banner'
    )
  );
