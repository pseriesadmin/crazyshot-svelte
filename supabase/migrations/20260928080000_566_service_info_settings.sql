-- Migration #566: '서비스 기본 정보' CMS 설정 신설 (사업자 정보 9개 필드)
-- rental_policy_settings(Migration #565)와 동일한 싱글톤 패턴.
--
-- 배경: 사업자명·대표자명·사업자번호 등이 PC 공통푸터/모바일 멤버십 푸터/표준계약서
-- 임대인 정보 3곳에 서로 다른 값으로 하드코딩돼 있었다(플랜 문서 "서비스 기본 정보 CMS
-- 설정 신설" 조사 결과). 이 테이블을 단일 소스로 신설하고 3곳 모두 여기서 값을 읽도록
-- 교체한다(코드 변경은 별도 파일). 시드값은 Stephen 확정에 따라 PC 공통푸터의 기존
-- 하드코딩 값을 그대로 채택한다.

-- ─── 1. service_info_settings 테이블 (싱글톤 1행) ───────────────────────────
CREATE TABLE IF NOT EXISTS service_info_settings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name       TEXT NOT NULL DEFAULT '',  -- 사업자명(상호명)
  ceo_name           TEXT NOT NULL DEFAULT '',  -- 대표자명
  biz_address        TEXT NOT NULL DEFAULT '',  -- 사업장 소재지
  biz_reg_no         TEXT NOT NULL DEFAULT '',  -- 사업자등록번호
  mail_order_biz_no  TEXT NOT NULL DEFAULT '',  -- 통신판매업신고번호
  privacy_officer    TEXT NOT NULL DEFAULT '',  -- 개인정보관리책임자
  ceo_email          TEXT NOT NULL DEFAULT '',  -- 대표 이메일
  cs_phone           TEXT NOT NULL DEFAULT '',  -- 고객센터 번호
  business_hours     TEXT NOT NULL DEFAULT '',  -- 운영시간 안내
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE service_info_settings ENABLE ROW LEVEL SECURITY;

-- 공개 조회 (비로그인 고객도 보는 푸터·서명 페이지에서 읽어야 함)
CREATE POLICY "service_info_settings: 공개 조회"
  ON service_info_settings FOR SELECT
  USING (true);

-- CMS 관리자 전체 액세스
CREATE POLICY "service_info_settings: cms 관리"
  ON service_info_settings FOR ALL
  USING (is_cms_user())
  WITH CHECK (is_cms_user());

-- 싱글톤 초기 행 — PC 공통푸터(+layout.svelte) 기존 하드코딩 값을 그대로 시드
INSERT INTO service_info_settings (
  company_name, ceo_name, biz_address, biz_reg_no, mail_order_biz_no,
  privacy_officer, ceo_email, cs_phone, business_hours
)
SELECT
  '(주)크레이지샷',
  '한광익',
  '서울특별시 강서구 양천로 418. 2층 202호(등촌동)',
  '372-81-03954',
  '제 2026-서울강서-0597호',
  '한광익',
  'crazyshothq@naver.com',
  '1588-0033',
  '평일·공휴일 09:00~22:00'
WHERE NOT EXISTS (SELECT 1 FROM service_info_settings);

-- ─── 2. get_service_info_settings RPC (공개 읽기) ──────────────────────────
CREATE OR REPLACE FUNCTION public.get_service_info_settings()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row service_info_settings%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM service_info_settings LIMIT 1;
  RETURN jsonb_build_object(
    'company_name',      COALESCE(v_row.company_name, ''),
    'ceo_name',           COALESCE(v_row.ceo_name, ''),
    'biz_address',        COALESCE(v_row.biz_address, ''),
    'biz_reg_no',         COALESCE(v_row.biz_reg_no, ''),
    'mail_order_biz_no',  COALESCE(v_row.mail_order_biz_no, ''),
    'privacy_officer',    COALESCE(v_row.privacy_officer, ''),
    'ceo_email',          COALESCE(v_row.ceo_email, ''),
    'cs_phone',           COALESCE(v_row.cs_phone, ''),
    'business_hours',     COALESCE(v_row.business_hours, '')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_service_info_settings() TO anon, authenticated;

-- ─── 3. upsert_service_info_settings RPC (CMS 저장) ────────────────────────
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
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  IF EXISTS (SELECT 1 FROM service_info_settings LIMIT 1) THEN
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
      updated_at        = NOW();
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
-- DROP FUNCTION IF EXISTS public.upsert_service_info_settings(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
-- DROP FUNCTION IF EXISTS public.get_service_info_settings();
-- DROP TABLE IF EXISTS service_info_settings;
-- ============================================================
