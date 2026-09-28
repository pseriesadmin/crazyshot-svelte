-- Migration #568: upsert_rental_policy_settings — UPDATE에 WHERE절 누락 결함 수정
--
-- 배경(2026-09-28): Migration #567(upsert_service_info_settings)과 동일한 클래스의 결함.
-- 이 Supabase 프로젝트는 PostgREST가 접속하는 `authenticator` 역할에
-- `session_preload_libraries=supautils, safeupdate`가 Supabase 플랫폼 표준으로 이미 적용돼
-- 있다(이 프로젝트가 별도로 켠 것이 아님). `safeupdate` 확장은 WHERE절 없는 UPDATE/DELETE를
-- SQLSTATE 21000 "UPDATE requires a WHERE clause"로 즉시 거부한다.
--
-- Migration #565의 upsert_rental_policy_settings UPDATE 분기가 "싱글톤 테이블이라 항상
-- 1행"이라는 전제로 WHERE절 없이 작성돼 있어, 실제 CMS "법적 고지"(개인정보처리방침·
-- 서비스이용정책·환불규정) 저장 버튼이 100% 실패하는 상태였다(#567과 동일한 방식으로
-- 재현·확정 — postgres/service_role 직접 연결에서는 재현되지 않고, 실제 CMS가 쓰는
-- PostgREST RPC 경로에서만 재현됨).
--
-- 수정: EXISTS 체크 대신 대상 행의 id를 먼저 조회해 UPDATE ... WHERE id = v_id로 변경.
-- 로직·시그니처·권한은 100% 동일(CREATE OR REPLACE) — WHERE절 추가만 한 최소 수정.

CREATE OR REPLACE FUNCTION public.upsert_rental_policy_settings(
  p_privacy TEXT DEFAULT NULL,
  p_terms   TEXT DEFAULT NULL,
  p_refund  TEXT DEFAULT NULL
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

  SELECT id INTO v_id FROM rental_policy_settings LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE rental_policy_settings SET
      privacy_text = COALESCE(p_privacy, privacy_text),
      terms_text   = COALESCE(p_terms,   terms_text),
      refund_text  = COALESCE(p_refund,  refund_text),
      updated_at   = NOW()
    WHERE id = v_id;
  ELSE
    INSERT INTO rental_policy_settings (privacy_text, terms_text, refund_text)
    VALUES (COALESCE(p_privacy, ''), COALESCE(p_terms, ''), COALESCE(p_refund, ''));
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_rental_policy_settings(TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Migration #565의 upsert_rental_policy_settings 정의(WHERE절 없는 UPDATE)로 CREATE OR REPLACE 복원.
-- ============================================================
