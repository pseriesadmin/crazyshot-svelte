-- Migration #97: 회원 코드 시스템
-- 목적: 상품 코드(CSCAM2607001)와 동일 체계의 회원 식별 코드 도입
--   B2C 일반회원: CSBC2607001
--   B2B 기업회원: CSBB2607001
-- PK는 UUID 유지 (auth.uid 기반 RLS 보존). member_code는 UNIQUE 보조 식별자.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. user_profiles에 컬럼 추가

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS member_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS member_type TEXT
    NOT NULL DEFAULT 'B2C'
    CHECK (member_type IN ('B2C', 'B2B'));

-- 2. member_code 부분 인덱스 (NULL 제외 — product_code 패턴 동일)

CREATE INDEX IF NOT EXISTS idx_user_profiles_member_code
  ON user_profiles (member_code)
  WHERE member_code IS NOT NULL;

-- 3. member_code_sequences 채번 테이블 (product_code_sequences 동일 패턴)

CREATE TABLE IF NOT EXISTS member_code_sequences (
  id          BIGSERIAL    PRIMARY KEY,
  member_type VARCHAR(2)   NOT NULL,   -- 'BC' or 'BB'
  year_month  VARCHAR(6)   NOT NULL,   -- 'YYMM' 또는 'all'
  next_seq    INT          NOT NULL DEFAULT 1
    CHECK (next_seq >= 1),
  UNIQUE (member_type, year_month)
);

COMMENT ON TABLE member_code_sequences IS
  '회원 코드 채번 시퀀스 — member_type별·월별 단조증가, product_code_sequences 동일 패턴';

-- 4. generate_member_code() RPC

CREATE OR REPLACE FUNCTION generate_member_code(
  p_member_type TEXT,                  -- 'B2C' or 'B2B'
  p_use_yymm    BOOLEAN DEFAULT true
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type_code   TEXT;
  v_year_month  TEXT;
  v_seq         INT;
  v_seq_str     TEXT;
  v_code        TEXT;
BEGIN
  IF p_member_type NOT IN ('B2C', 'B2B') THEN
    RAISE EXCEPTION 'invalid member_type: % (must be B2C or B2B)', p_member_type;
  END IF;

  v_type_code  := CASE p_member_type WHEN 'B2C' THEN 'BC' ELSE 'BB' END;
  v_year_month := CASE WHEN p_use_yymm THEN TO_CHAR(NOW(), 'YYMM') ELSE 'all' END;

  -- 원자적 채번 (INSERT ON CONFLICT DO UPDATE)
  INSERT INTO member_code_sequences (member_type, year_month, next_seq)
    VALUES (v_type_code, v_year_month, 2)
    ON CONFLICT (member_type, year_month) DO UPDATE
    SET next_seq = member_code_sequences.next_seq + 1
    RETURNING next_seq - 1 INTO v_seq;

  v_seq_str := LPAD(v_seq::TEXT, 3, '0');
  v_code    := 'CS' || v_type_code ||
               CASE WHEN p_use_yymm THEN v_year_month ELSE '' END ||
               v_seq_str;

  RETURN v_code;
END;
$$;

COMMENT ON FUNCTION generate_member_code(TEXT, BOOLEAN) IS
  '회원 코드 채번 — B2C→CSBC2607001, B2B→CSBB2607001 (product_code 체계 동일)';

-- 5. NULL 퇴행 방지 트리거 (product_code_integrity #96 패턴 동일)

CREATE OR REPLACE FUNCTION prevent_member_code_nullification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.member_code IS NOT NULL AND NEW.member_code IS NULL THEN
    RAISE EXCEPTION
      'member_code_protected: cannot set member_code to NULL once assigned (user_id: %)', OLD.user_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_member_code_null ON user_profiles;
CREATE TRIGGER trg_prevent_member_code_null
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_member_code_nullification();

COMMENT ON FUNCTION prevent_member_code_nullification() IS
  '배정된 member_code를 NULL로 되돌리는 UPDATE 차단';

-- 6. subscriptions에 billing_key 추가 (토스페이먼츠 정기결제 빌링키)

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS billing_key TEXT;

COMMENT ON COLUMN subscriptions.billing_key IS
  '토스페이먼츠 정기결제 빌링키 — 구독 갱신 시 사용';
