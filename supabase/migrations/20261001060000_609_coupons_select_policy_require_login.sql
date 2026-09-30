-- Migration 609 — coupons 고객 조회 정책에 "로그인 필요" 조건 추가 (Production 드리프트 교정, 2026-10-01)
--
-- 배경: DRIFT 점검(2026-10-01)에서 Production의 coupons_user_select 정책이
--   USING (is_active = true AND deleted_at IS NULL)  — auth.uid() IS NOT NULL 조건이 없어
--   비로그인(anon 키만 가진) 사용자도 활성 쿠폰 전체(코드·할인액 등)를 조회할 수 있었다(점검 시점 12건 노출).
--   Stage는 "coupons: 유효 쿠폰 조회" 정책에 이미 auth.uid() IS NOT NULL이 있어 로그인 사용자만 조회 가능했다.
-- 조치: Production 정책에 같은 조건을 추가해 Stage와 일치시킨다. 익명 로그인(signInAnonymously)은 auth.uid()가 있어 영향 없음.
-- 영향 확인: 앱의 coupons 직접 조회는 모두 서버 service_role 또는 로그인 사용자 세션(user_coupons 조인)이다. 비로그인 조회 경로 없음.
-- 멱등: 두 환경의 정책 이름이 달라(Production coupons_user_select / Stage "coupons: 유효 쿠폰 조회") 존재하는 이름을 모두 처리한다.
--   Stage는 이미 같은 정의라 실질 변경 없음.

DO $do$
DECLARE
  v_name TEXT;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['coupons_user_select', 'coupons: 유효 쿠폰 조회'] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'coupons' AND policyname = v_name
    ) THEN
      EXECUTE format(
        'ALTER POLICY %I ON public.coupons USING ((is_active = true) AND (deleted_at IS NULL) AND (auth.uid() IS NOT NULL))',
        v_name
      );
    END IF;
  END LOOP;
END
$do$;

-- ROLLBACK(참고용)
-- ALTER POLICY coupons_user_select ON public.coupons USING ((is_active = true) AND (deleted_at IS NULL));
