-- Migration #641: 포인트 사용 규칙 설정 쓰기를 서버(service_role) 전용으로 제한 (2026-10-04, CRITICAL — sp3 QA M-1)
--
-- 배경: Migration #639의 upsert_point_use_settings는 authenticated에 GRANT되고 내부 검사가 is_cms_user()뿐이며,
--   point_use_settings 테이블 RLS도 FOR ALL USING(is_cms_user())라서 cms_role이 있기만 하면(partner 포함)
--   PostgREST로 규칙을 직접 바꿀 수 있었다. 이 값(사용 OFF·최대 비율 0 등)은 고객 결제에 바로 영향을 주고,
--   security-auth.md는 설정 변경을 manager 이상으로 두므로 DB 쪽도 닫는다.
-- 변경: ① 테이블의 CMS 쓰기 정책 제거(공개 조회 정책만 유지) ② upsert 함수를 service_role 전용으로 재정의
--   (내부 is_cms_user() 검사 제거 — 호출자는 manager 이상 게이트를 통과한 앱 서버 액션뿐)
--
-- ROLLBACK (필요 시 수동 실행):
--   CREATE POLICY "point_use_settings: cms 관리" ON public.point_use_settings FOR ALL USING (is_cms_user()) WITH CHECK (is_cms_user());
--   upsert_point_use_settings를 Migration #639 정의(내부 is_cms_user() 검사 포함)로 CREATE OR REPLACE 복원 후
--   GRANT EXECUTE ... TO authenticated, service_role;

DROP POLICY IF EXISTS "point_use_settings: cms 관리" ON public.point_use_settings;

-- anon/authenticated의 테이블 쓰기 권한도 회수(RLS 정책이 없어 막히지만 이중 방어)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.point_use_settings FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.upsert_point_use_settings(
  p_use_enabled    BOOLEAN DEFAULT NULL,
  p_min_use_points INTEGER DEFAULT NULL,
  p_use_unit       INTEGER DEFAULT NULL,
  p_max_use_ratio  INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.point_use_settings LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.point_use_settings (use_enabled, min_use_points, use_unit, max_use_ratio)
    VALUES (COALESCE(p_use_enabled, TRUE), COALESCE(p_min_use_points, 0), COALESCE(p_use_unit, 1), COALESCE(p_max_use_ratio, 100));
  ELSE
    UPDATE public.point_use_settings
    SET use_enabled    = COALESCE(p_use_enabled, use_enabled),
        min_use_points = COALESCE(p_min_use_points, min_use_points),
        use_unit       = COALESCE(p_use_unit, use_unit),
        max_use_ratio  = COALESCE(p_max_use_ratio, max_use_ratio),
        updated_at     = NOW()
    WHERE id = v_id;
  END IF;

  RETURN public.get_point_use_settings();
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_point_use_settings(BOOLEAN, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_point_use_settings(BOOLEAN, INTEGER, INTEGER, INTEGER) TO service_role;
