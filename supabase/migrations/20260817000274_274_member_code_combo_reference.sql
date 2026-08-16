-- Migration #274: 회원코드 코드조합 기준설정 — generate_member_code 확장 + 일괄 재발급
--
-- 배경: /cms/customers '설정' 서브메뉴 신설 플랜(Plan Mode 설계, AskUserQuestion 2건 확정).
-- 회원코드(user_profiles.member_code)가 /cms/codes 코드조합 시스템과 완전히 무관한 하드코딩
-- 로직(migration 97/102 — B2C→'BC'/B2B→'BB' 고정)으로만 동작하던 것을, cms_settings에 저장된
-- 코드조합 기준(선택 사항)을 읽어 반영하도록 확장한다. 설정이 없으면 기존 동작 100% 그대로.
--
-- 절대 제약:
--   ① ADD-ONLY — migration 97/102 파일 직접 수정 없음
--   ② generate_member_code 파라미터 추가는 DROP 후 재생성(개수 변경 시 PGRST203 오버로드
--      모호성 방지 — products.md §2-3/migration 261 get_customer_list 선례와 동일 컨벤션)
--   ③ p_category_code_override는 반드시 DEFAULT NULL — 기존 호출부(auto_assign_member_code)
--      외 다른 곳에서 이 RPC를 호출해도 시그니처가 깨지지 않음
--   ④ prevent_member_code_nullification 트리거는 무변경(NULL 방지 목적 그대로 — 일괄 재발급은
--      NULL이 아닌 새 값으로의 UPDATE라 이 트리거와 충돌 없음)
--
-- stage(ezyvffjvuwmtuhpxdjrw) 먼저 적용·검증 → production(vnbpmvxruyciuuaermyh)은 Stephen 승인 후.

-- ── 1. generate_member_code 확장 — override 파라미터 추가 ──────────────────────
DROP FUNCTION IF EXISTS public.generate_member_code(TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION public.generate_member_code(
  p_member_type            TEXT,
  p_use_yymm                BOOLEAN DEFAULT true,
  p_category_code_override TEXT    DEFAULT NULL
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

  -- 코드조합 기준이 설정돼 있으면 그 접두어를 사용, 없으면 기존 B2C→BC/B2B→BB 하드코딩 폴백
  -- (완전 하위호환 — /cms/customers/settings에서 기준을 지정한 적 없는 프로젝트는 무변경).
  IF p_category_code_override IS NOT NULL AND p_category_code_override <> '' THEN
    v_type_code := p_category_code_override;
  ELSE
    v_type_code := CASE p_member_type WHEN 'B2C' THEN 'BC' ELSE 'BB' END;
  END IF;

  v_year_month := CASE WHEN p_use_yymm THEN TO_CHAR(NOW(), 'YYMM') ELSE 'all' END;

  -- 원자적 채번 (INSERT ON CONFLICT DO UPDATE) — 기존 member_code_sequences 그대로 재사용.
  -- ⚠️ 시퀀스 키는 반드시 v_type_code(실제로 코드에 찍히는 접두어) 기준이어야 한다 — 만약 여기를
  -- member_type(B2C/B2B) 기준으로 키를 나누면, override 사용 시 두 타입이 동일한 v_type_code를
  -- 공유하면서도 각자 독립된 카운터에서 번호를 받아, 서로 다른 고객이 동일한 회원코드를 발급받는
  -- 충돌이 발생한다(실사용 TDD 테스트로 실제 재현·확인된 버그 — 최초 구현 당시 member_type 기준
  -- 이었던 것을 v_type_code 기준으로 수정). override 미지정 시 v_type_code는 기존과 동일하게
  -- BC/BB이므로 하위호환에는 영향 없음.
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

COMMENT ON FUNCTION public.generate_member_code(TEXT, BOOLEAN, TEXT) IS
  '회원 코드 채번 — p_category_code_override 지정 시 그 접두어 사용(코드조합 기준설정),
   미지정 시 기존 B2C→BC/B2B→BB 하드코딩 폴백(하위호환).';

-- ── 2. auto_assign_member_code 트리거 확장 — cms_settings 조회해 override 전달 ────────
CREATE OR REPLACE FUNCTION public.auto_assign_member_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_override TEXT;
BEGIN
  IF NEW.member_code IS NULL THEN
    SELECT value->>'prefix' INTO v_override
    FROM cms_settings
    WHERE key = 'member_code_format';

    NEW.member_code := generate_member_code(
      COALESCE(NEW.member_type, 'B2C'),
      true,
      v_override
    );
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.auto_assign_member_code() IS
  '신규 user_profiles INSERT 시 member_code 자동 배정 — cms_settings.member_code_format이
   설정돼 있으면 그 접두어를 사용, 없으면 generate_member_code 기본 폴백(BC/BB).';

-- ── 3. 일괄 재발급 이력 로그 테이블 ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS member_code_reissue_log (
  id            BIGSERIAL     PRIMARY KEY,
  user_id       UUID          NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  old_code      TEXT,
  new_code      TEXT          NOT NULL,
  reissued_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  reissued_by   TEXT          NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_member_code_reissue_log_user_id
  ON member_code_reissue_log (user_id);

COMMENT ON TABLE member_code_reissue_log IS
  '회원코드 일괄 재발급 이력 — 되돌릴 수 없는 대량 변경이라 CS 문의 대응용 최소 추적성 확보.';

ALTER TABLE member_code_reissue_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "member_code_reissue_log: cms only"
  ON member_code_reissue_log
  FOR ALL
  USING (is_cms_user());

-- ── 4. bulk_reissue_member_codes RPC — 기존 고객 일괄 재발급 ──────────────────────
CREATE OR REPLACE FUNCTION public.bulk_reissue_member_codes(
  p_prefix       TEXT,
  p_reissued_by  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec           RECORD;
  v_old_code    TEXT;
  v_new_code    TEXT;
  v_count       INT := 0;
BEGIN
  IF p_prefix IS NULL OR p_prefix = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_PREFIX');
  END IF;

  FOR rec IN
    SELECT id, member_code, COALESCE(member_type, 'B2C') AS mtype
    FROM user_profiles
    WHERE deleted_at IS NULL
    ORDER BY created_at ASC
  LOOP
    v_old_code := rec.member_code;
    v_new_code := generate_member_code(rec.mtype, true, p_prefix);

    UPDATE user_profiles
    SET member_code = v_new_code
    WHERE id = rec.id;

    INSERT INTO member_code_reissue_log (user_id, old_code, new_code, reissued_by)
    VALUES (rec.id, v_old_code, v_new_code, p_reissued_by);

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'reissued_count', v_count);
END;
$$;

COMMENT ON FUNCTION public.bulk_reissue_member_codes(TEXT, TEXT) IS
  '기존 고객 전원의 member_code를 새 접두어로 일괄 재발급하고 member_code_reissue_log에
   변경 전/후 값을 기록한다. 되돌릴 수 없는 대량 UPDATE — 앱 레이어에서 명시적 확인 후에만
   호출돼야 한다(/cms/customers/settings bulkReissue 액션).';

REVOKE ALL ON FUNCTION public.generate_member_code(TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.generate_member_code(TEXT, BOOLEAN, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.bulk_reissue_member_codes(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.bulk_reissue_member_codes(TEXT, TEXT) TO service_role;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP FUNCTION IF EXISTS public.bulk_reissue_member_codes(TEXT, TEXT);
-- DROP TABLE IF EXISTS member_code_reissue_log;
-- CREATE OR REPLACE FUNCTION public.auto_assign_member_code() ... (migration 102 원본으로 복원)
-- DROP FUNCTION IF EXISTS public.generate_member_code(TEXT, BOOLEAN, TEXT);
-- CREATE OR REPLACE FUNCTION public.generate_member_code(TEXT, BOOLEAN) ... (migration 97 원본으로 복원)
-- ============================================================
