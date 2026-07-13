-- Migration #102: 회원 코드 자동 배정
-- 목적: generate_member_code() RPC 호출 지점 연결
--   ① 기존 member_code=NULL 사용자 일괄 배정 (Migration 적용 시 1회)
--   ② BEFORE INSERT 트리거로 신규 가입자 자동 배정
-- 선행 의존: #97 (generate_member_code RPC + member_code_sequences 테이블)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. 신규 가입자 자동 배정 트리거 함수
--    BEFORE INSERT: NEW.member_code에 직접 값을 써서 INSERT 한 번에 처리

CREATE OR REPLACE FUNCTION auto_assign_member_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.member_code IS NULL THEN
    NEW.member_code := generate_member_code(
      COALESCE(NEW.member_type, 'B2C'),
      true   -- p_use_yymm: YYMM 포함 (CSBC2607001 형식)
    );
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION auto_assign_member_code() IS
  '신규 user_profiles INSERT 시 member_code 자동 배정 — generate_member_code() 경유';

-- 2. BEFORE INSERT 트리거 등록

DROP TRIGGER IF EXISTS trg_auto_assign_member_code ON user_profiles;
CREATE TRIGGER trg_auto_assign_member_code
  BEFORE INSERT ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION auto_assign_member_code();

-- 3. 기존 member_code=NULL 사용자 일괄 배정
--    가입 순서(created_at ASC)로 채번 — 코드 연속성 보장
--    WHERE member_code IS NULL 이중 체크: 트랜잭션 중 race condition 방지

DO $$
DECLARE
  rec    RECORD;
  v_code TEXT;
BEGIN
  FOR rec IN
    SELECT id, COALESCE(member_type, 'B2C') AS mtype
    FROM   user_profiles
    WHERE  member_code IS NULL
      AND  deleted_at IS NULL
    ORDER  BY created_at ASC
  LOOP
    v_code := generate_member_code(rec.mtype, true);

    UPDATE user_profiles
    SET    member_code = v_code
    WHERE  id          = rec.id
      AND  member_code IS NULL;   -- 동시 실행 시 중복 배정 방지
  END LOOP;

  RAISE NOTICE 'auto_assign_member_code: batch assignment complete';
END;
$$;

-- 4. 배정 결과 확인용 (적용 후 쿼리로 검증)
-- SELECT COUNT(*) FROM user_profiles WHERE member_code IS NULL AND deleted_at IS NULL;
-- → 0 이어야 함
