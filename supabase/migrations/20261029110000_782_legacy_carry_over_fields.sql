-- #782 레거시 회원 부가 정보 보관 — 구매금액·관리자 메모·생년월일 (2026-10-29, 1단계)
-- 롤백: ALTER TABLE legacy_member_staging DROP COLUMN legacy_purchase_amount, DROP COLUMN legacy_memo, DROP COLUMN birth_date;
--       ALTER TABLE user_profiles DROP COLUMN legacy_purchase_amount; DROP TABLE public.legacy_member_notes;
--       find_legacy_member 는 #746 본문으로 되돌린다.
--
-- 배경: 이전 서비스 원본 CSV 에는 구매금액·관리자 메모·가입 방식이 있는데, 업로드가 6열 형식만 읽어 이전 계정에 반영되지 않았다.
--  · 구매금액: 구매횟수 옆에 참고용으로 보관(대기 목록 → 인증 완료 시 프로필)
--  · 생년월일: 값이 있을 때만 인증 완료 시 프로필 생년월일(user_profiles.birth_date)로 옮긴다
--  · 관리자 메모: 고객이 자기 프로필을 읽을 때 같이 나가지 않도록 프로필이 아니라 서버 전용 테이블(legacy_member_notes)에 둔다.
--    대기 목록(legacy_member_staging)은 이미 서버 전용이라 메모 칸을 그대로 둔다.
--  · 가입 방식은 기존 legacy_source 칸(자유 문자열)에 kakao/naver/google/email 등을 저장하므로 구조 변경 없음.

-- 1) 대기 목록
ALTER TABLE legacy_member_staging
  ADD COLUMN IF NOT EXISTS legacy_purchase_amount BIGINT NOT NULL DEFAULT 0 CHECK (legacy_purchase_amount >= 0),
  ADD COLUMN IF NOT EXISTS legacy_memo            TEXT,
  ADD COLUMN IF NOT EXISTS birth_date             DATE;

-- 2) 프로필(구매금액만 — 구매횟수 legacy_purchase_count 와 같은 성격의 참고 값)
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS legacy_purchase_amount BIGINT NOT NULL DEFAULT 0 CHECK (legacy_purchase_amount >= 0);

COMMENT ON COLUMN user_profiles.legacy_purchase_amount IS '원 서비스 구매금액(KRW, CSV 원본). rental 결제 금액과 완전히 별개 — 참고용, 혼용 금지.';

-- 3) 관리자 메모 보관 — 서버 전용(service_role), 정책 없음 = 클라이언트 직접 접근 완전 차단
CREATE TABLE IF NOT EXISTS public.legacy_member_notes (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  memo       TEXT        NOT NULL,
  source     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_legacy_member_notes_user ON public.legacy_member_notes(user_id);
ALTER TABLE public.legacy_member_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legacy_member_notes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.legacy_member_notes TO service_role;
COMMENT ON TABLE public.legacy_member_notes IS '이전 서비스 관리자 메모(CMS 전용). 고객 프로필·고객 화면에 노출하지 않는다. 인증 완료(complete) 때 대기 목록 메모를 옮긴다.';

-- 4) 인증 완료 조회 — 새 항목을 함께 돌려준다(시그니처·서버 전용 권한 그대로)
CREATE OR REPLACE FUNCTION find_legacy_member(
  p_name  TEXT,
  p_phone TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row legacy_member_staging%ROWTYPE;
BEGIN
  SELECT *
  INTO   v_row
  FROM   public.legacy_member_staging
  WHERE  UPPER(REGEXP_REPLACE(full_name, '\s', '', 'g')) = UPPER(REGEXP_REPLACE(p_name, '\s', '', 'g'))
    AND  phone                  = p_phone
    AND  claimed_at             IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'staging_id',             v_row.id::text,
    'email',                  v_row.email,
    'name',                   v_row.full_name,
    'phone',                  v_row.phone,
    'legacy_source',          v_row.legacy_source,
    'legacy_signup_at',       v_row.legacy_signup_at,
    'legacy_purchase_count',  v_row.legacy_purchase_count,
    'legacy_imported_at',     v_row.imported_at,
    'legacy_purchase_amount', v_row.legacy_purchase_amount,
    'legacy_memo',            v_row.legacy_memo,
    'birth_date',             v_row.birth_date
  );
END;
$$;

REVOKE ALL ON FUNCTION find_legacy_member(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION find_legacy_member(TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION find_legacy_member(TEXT, TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION find_legacy_member(TEXT, TEXT) TO service_role;
