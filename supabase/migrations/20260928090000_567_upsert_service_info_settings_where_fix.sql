-- Migration #567: upsert_service_info_settings — UPDATE에 WHERE절 누락 결함 수정
--
-- 배경(2026-09-28, '서비스 기본 정보' 저장 기능 정밀 검증 중 발견):
-- Supabase 프로젝트는 REST API(PostgREST)가 접속하는 `authenticator` 역할에
-- `session_preload_libraries=supautils, safeupdate`가 기본 적용돼 있다(Supabase 플랫폼
-- 표준 설정 — 이 프로젝트가 별도로 켠 것이 아님). `safeupdate` 확장은 WHERE절 없는
-- UPDATE/DELETE를 SQLSTATE 21000 "UPDATE requires a WHERE clause"로 즉시 거부한다.
--
-- Migration #566의 upsert_service_info_settings UPDATE 분기가 WHERE절 없이
-- (싱글톤 테이블이라 항상 1행이라는 전제로) 작성돼 있었는데, `postgres`/service_role로
-- 직접 붙는 연결(이 세션의 SQL 실행 도구 등)에서는 이 확장이 적용되지 않아 정상 동작했지만,
-- 실제 CMS 화면이 쓰는 PostgREST RPC 경로(authenticated 역할)에서는 매번 이 에러로
-- 저장이 100% 실패했다(실사용 재현 확인 — 직접 REST 호출로 SQLSTATE 21000 확인).
--
-- 수정: EXISTS 체크 대신 대상 행의 id를 먼저 조회해 UPDATE ... WHERE id = v_id로 변경.
-- 로직·시그니처·권한은 100% 동일(CREATE OR REPLACE) — WHERE절 추가만 한 최소 수정.
--
-- ⚠️ 동일 클래스 결함이 rental_policy_settings.upsert_rental_policy_settings(#565)에도
-- 그대로 존재한다(같은 "싱글톤이라 WHERE 생략" 패턴) — 이번 수정 범위는 service_info_settings
-- 뿐이며, 정책텍스트 쪽은 별도 확인·승인 후 조치 필요(요청 범위 외 수정 금지 원칙).

CREATE OR REPLACE FUNCTION public.upsert_service_info_settings(
  p_company_name      TEXT DEFAULT NULL,
  p_ceo_name          TEXT DEFAULT NULL,
  p_biz_address       TEXT DEFAULT NULL,
  p_biz_reg_no        TEXT DEFAULT NULL,
  p_mail_order_biz_no TEXT DEFAULT NULL,
  p_privacy_officer   TEXT DEFAULT NULL,
  p_ceo_email         TEXT DEFAULT NULL,
  p_cs_phone          TEXT DEFAULT NULL,
  p_business_hours    TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  SELECT id INTO v_id FROM service_info_settings LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE service_info_settings SET
      company_name      = COALESCE(p_company_name,      company_name),
      ceo_name          = COALESCE(p_ceo_name,           ceo_name),
      biz_address       = COALESCE(p_biz_address,        biz_address),
      biz_reg_no        = COALESCE(p_biz_reg_no,         biz_reg_no),
      mail_order_biz_no = COALESCE(p_mail_order_biz_no,  mail_order_biz_no),
      privacy_officer   = COALESCE(p_privacy_officer,    privacy_officer),
      ceo_email         = COALESCE(p_ceo_email,          ceo_email),
      cs_phone          = COALESCE(p_cs_phone,           cs_phone),
      business_hours    = COALESCE(p_business_hours,     business_hours),
      updated_at        = NOW()
    WHERE id = v_id;
  ELSE
    INSERT INTO service_info_settings (
      company_name, ceo_name, biz_address, biz_reg_no, mail_order_biz_no,
      privacy_officer, ceo_email, cs_phone, business_hours
    )
    VALUES (
      COALESCE(p_company_name, ''), COALESCE(p_ceo_name, ''), COALESCE(p_biz_address, ''),
      COALESCE(p_biz_reg_no, ''), COALESCE(p_mail_order_biz_no, ''), COALESCE(p_privacy_officer, ''),
      COALESCE(p_ceo_email, ''), COALESCE(p_cs_phone, ''), COALESCE(p_business_hours, '')
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_service_info_settings(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Migration #566의 upsert_service_info_settings 정의(WHERE절 없는 UPDATE)로 CREATE OR REPLACE 복원.
-- ============================================================
