-- Migration #565: 푸터 법적 고지 텍스트 관리 (rental_guide_settings 패턴)
-- 개인정보처리방침 / 서비스이용정책 / 환불규정
-- 단일행 테이블 + 공개 조회 RLS + CMS 관리 RPC

-- ─── 1. rental_policy_settings 테이블 (싱글톤 1행) ───────────────────────────
CREATE TABLE IF NOT EXISTS rental_policy_settings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  privacy_text TEXT DEFAULT '',
  terms_text   TEXT DEFAULT '',
  refund_text  TEXT DEFAULT '',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rental_policy_settings ENABLE ROW LEVEL SECURITY;

-- 공개 조회 (푸터 모달에서 anon/authenticated 모두 읽을 수 있어야 함)
CREATE POLICY "rental_policy_settings: 공개 조회"
  ON rental_policy_settings FOR SELECT
  USING (true);

-- CMS 관리자 전체 액세스
CREATE POLICY "rental_policy_settings: cms 관리"
  ON rental_policy_settings FOR ALL
  USING (is_cms_user())
  WITH CHECK (is_cms_user());

-- 싱글톤 초기 행
INSERT INTO rental_policy_settings (privacy_text, terms_text, refund_text)
VALUES ('', '', '')
ON CONFLICT DO NOTHING;

-- ─── 2. get_rental_policy_settings RPC (공개 읽기) ─────────────────────────
CREATE OR REPLACE FUNCTION public.get_rental_policy_settings()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row rental_policy_settings%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM rental_policy_settings LIMIT 1;
  RETURN jsonb_build_object(
    'privacy_text', COALESCE(v_row.privacy_text, ''),
    'terms_text',   COALESCE(v_row.terms_text, ''),
    'refund_text',  COALESCE(v_row.refund_text, '')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_rental_policy_settings() TO anon, authenticated;

-- ─── 3. upsert_rental_policy_settings RPC (CMS 저장) ─────────────────────────
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
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  IF EXISTS (SELECT 1 FROM rental_policy_settings LIMIT 1) THEN
    UPDATE rental_policy_settings SET
      privacy_text = COALESCE(p_privacy, privacy_text),
      terms_text   = COALESCE(p_terms,   terms_text),
      refund_text  = COALESCE(p_refund,  refund_text),
      updated_at   = NOW();
  ELSE
    INSERT INTO rental_policy_settings (privacy_text, terms_text, refund_text)
    VALUES (COALESCE(p_privacy, ''), COALESCE(p_terms, ''), COALESCE(p_refund, ''));
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_rental_policy_settings(TEXT, TEXT, TEXT) TO authenticated;
