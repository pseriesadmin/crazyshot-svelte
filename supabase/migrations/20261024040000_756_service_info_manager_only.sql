-- Migration #756: '서비스 기본 정보' 저장 RPC를 매니저 이상 전용으로 (Stephen 지시 "서비스 기본 정보 저장 권한도 막아줘" 2026-10-24)
-- 배경: #566·#567 의 upsert_service_info_settings 는 is_cms_user()(cms_role 보유자 누구나)만 확인해, 화면 저장 액션(/cms/set/policy saveServiceInfo — manager 이상)과 달리
--       partner(협력사) 계정이 브라우저 세션으로 RPC를 직접 호출하면 공통 푸터·표준계약서의 사업자 정보를 덮어쓸 수 있었다(팀 정책 #754 검수에서 발견).
-- 변경: ① 권한 검사를 is_cms_manager_or_above()(Migration #647, manager·superadmin)로 교체 ② anon·PUBLIC 실행 권한 회수(이전엔 기본 권한으로 비로그인도 호출 가능했고 함수 안 검사에서만 막혔다).
--       본문은 직전 정본(#567, Stage 실제 정의로 확인)과 권한 검사 한 줄만 다르다. 시그니처·읽기 함수(get_service_info_settings)는 변경 없음.

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
  IF NOT public.is_cms_manager_or_above() THEN
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

REVOKE ALL ON FUNCTION public.upsert_service_info_settings(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_service_info_settings(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- ROLLBACK (#567 정의로 되돌리기 — partner 가 다시 저장할 수 있게 되므로 신중히): 위 함수에서 `public.is_cms_manager_or_above()` 를 `public.is_cms_user()` 로 되돌리고,
-- anon 실행 권한이 필요하면 GRANT EXECUTE ON FUNCTION public.upsert_service_info_settings(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon;
