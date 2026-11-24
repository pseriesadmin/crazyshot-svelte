-- Migration #849: cms-assets 저장소 쓰기(올리기·덮어쓰기·삭제)를 CMS 직원 전용으로 제한
--
-- 배경(sp5 A-Lite 2026-11-24 SEC-001, 기존 부채): cms-assets 버킷(공개, 5MB)의 INSERT/UPDATE/DELETE 정책이
--   'authenticated 전체'(Production: auth.role()='authenticated', Stage: TO authenticated)라 로그인한 누구나 —
--   익명 로그인 계정 포함(Stage 에 익명 계정 549개 존재 = 익명 로그인 활성) — 홈 배너·카테고리 아이콘·GNB 배지 등
--   공개 이미지를 덮어쓰거나 지우고 임의 SVG/PNG 를 우리 저장소로 서빙할 수 있었다.
--
-- 변경: 쓰기 3종 정책을 is_cms_user()(익명 제외 + user_profiles.cms_role 보유)로 교체. 읽기(공개 SELECT)는 그대로.
--   · 기존 정책 이름이 환경마다 달라(Stage: "cms-assets auth upload/update/delete", Production: cms_assets_auth_insert/update/delete)
--     두 이름 계열을 모두 DROP IF EXISTS 한 뒤 같은 이름으로 새로 만든다.
--   · cms-assets 에 올리는 화면은 전부 CMS 관리 모달(ProductHeroModal·ProductCategoryModal·HomeThemeGroupModal·
--     HypePackBannerModal·HypePackThemeGroupModal·GnbBadgeModal)이고 CMS 직원 로그인 상태에서만 열리므로 기능 영향 없음.
--   · 버킷 설정(공개·5MB·MIME 허용)과 SELECT 정책은 변경하지 않는다.
--
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh)

DROP POLICY IF EXISTS "cms-assets auth upload" ON storage.objects;
DROP POLICY IF EXISTS "cms-assets auth update" ON storage.objects;
DROP POLICY IF EXISTS "cms-assets auth delete" ON storage.objects;
DROP POLICY IF EXISTS cms_assets_auth_insert ON storage.objects;
DROP POLICY IF EXISTS cms_assets_auth_update ON storage.objects;
DROP POLICY IF EXISTS cms_assets_auth_delete ON storage.objects;

CREATE POLICY cms_assets_cms_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cms-assets' AND public.is_cms_user());

CREATE POLICY cms_assets_cms_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'cms-assets' AND public.is_cms_user())
  WITH CHECK (bucket_id = 'cms-assets' AND public.is_cms_user());

CREATE POLICY cms_assets_cms_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'cms-assets' AND public.is_cms_user());

-- ============================================================
-- ROLLBACK (필요 시 수동 실행 — 이전 상태로 되돌리면 로그인한 누구나 쓰기 가능해지므로 비권장)
-- ============================================================
-- DROP POLICY IF EXISTS cms_assets_cms_insert ON storage.objects;
-- DROP POLICY IF EXISTS cms_assets_cms_update ON storage.objects;
-- DROP POLICY IF EXISTS cms_assets_cms_delete ON storage.objects;
-- Production 이전 정책:
--   CREATE POLICY cms_assets_auth_insert ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id = 'cms-assets' AND auth.role() = 'authenticated');
--   CREATE POLICY cms_assets_auth_update ON storage.objects FOR UPDATE TO public USING (bucket_id = 'cms-assets' AND auth.role() = 'authenticated');
--   CREATE POLICY cms_assets_auth_delete ON storage.objects FOR DELETE TO public USING (bucket_id = 'cms-assets' AND auth.role() = 'authenticated');
-- Stage 이전 정책:
--   CREATE POLICY "cms-assets auth upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'cms-assets');
--   CREATE POLICY "cms-assets auth update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'cms-assets');
--   CREATE POLICY "cms-assets auth delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'cms-assets');
-- ============================================================
