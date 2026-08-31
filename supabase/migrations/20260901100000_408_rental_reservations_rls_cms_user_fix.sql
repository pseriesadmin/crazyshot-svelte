-- Migration 408 — rental_reservations RLS 관리자 정책 is_cms_user() 정합 (2026-09-01)
--
-- 배경: CMS 전역 정밀 검증 v5(cms_global_verification_v5_synthesis_2026-08-31.md)에서 발견 —
-- rental_reservations의 유일한 "관리자 전체" 정책(Migration #10)이 고객 등급용 is_admin()
-- (user_profiles.membership_grade = 'admin')을 검사하고 있었다. CMS 스태프(partner/manager/
-- superadmin, cms_role 기준)는 이 조건을 만족하지 않으므로, RLS로 걸러지는 모든 CMS 브라우저
-- 조회·구독(예: /cms/rentals의 Supabase Realtime postgres_changes 구독)이 구조적으로 미발화될
-- 위험이 있었다.
--
-- 이미 동일 클래스 버그가 products 테이블에 대해 Migration #196(products_rls_parent_child_fix)
-- 으로 is_admin() → is_cms_user() 로 정정된 전례가 있다 — 이 마이그레이션은 그 전례를 그대로
-- rental_reservations에 적용하는 기계적 수정이다. is_cms_user() 정의는 Migration #195에서
-- 이미 등록됨(cms_role IS NOT NULL 기준).
--
-- 영향 범위: RPC 경유(service_role) 상태변경·조회는 이 정책과 무관하게 항상 정상 동작해왔다
-- (서버 라우트가 SUPABASE_SERVICE_ROLE_KEY로 RLS를 우회하므로) — 이번 수정은 CMS 브라우저
-- 클라이언트가 직접 anon+authenticated 세션으로 rental_reservations를 조회/구독하는 경로에만
-- 영향을 준다.
--
-- 적용 순서: stage(ezyvffjvuwmtuhpxdjrw) 먼저 검증 → production(vnbpmvxruyciuuaermyh)은
-- Stephen 별도 승인 후 적용.

DROP POLICY IF EXISTS "rental_reservations: 관리자 전체" ON public.rental_reservations;

CREATE POLICY "rental_reservations: 관리자 전체" ON public.rental_reservations
  FOR ALL
  USING (public.is_cms_user())
  WITH CHECK (public.is_cms_user());

-- ── ROLLBACK(참고용) ──
-- DROP POLICY IF EXISTS "rental_reservations: 관리자 전체" ON public.rental_reservations;
-- CREATE POLICY "rental_reservations: 관리자 전체" ON public.rental_reservations
--   FOR ALL USING (is_admin());
