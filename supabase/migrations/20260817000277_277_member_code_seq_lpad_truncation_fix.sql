-- Migration #277: generate_member_code LPAD 절단(truncation) 버그 수정 — CRITICAL
--
-- 배경: Stephen이 /cms/customers/settings "② 기존 고객 일괄 재발급" 버튼 실행 시 에러 토스트가
-- 뜬다고 보고 → Stage DB 직접 RPC 재현으로 원인 확정.
--
-- 재현: SELECT bulk_reissue_member_codes('BC', 'debug') → 23505 duplicate key
--   Key (member_code)=(CSBC2608107) already exists.
--
-- 근본 원인(이 세션이 작성한 migration 274/276이 아니라 원본 migration 97부터 존재하던 결함):
--   generate_member_code() 내부의 v_seq_str := LPAD(v_seq::TEXT, 3, '0') 는 v_seq가 3자리를
--   넘어가면(1000 이상) "패딩"이 아니라 "오른쪽 절단(truncate)"으로 동작한다
--   (Postgres LPAD 스펙: 원본이 목표 길이보다 길면 오른쪽을 잘라낸다).
--     LPAD('1071', 3, '0') = '107'   (패딩 아님 — 마지막 자리 '1'이 잘려나감)
--     LPAD('1072', 3, '0') = '107'   (1071과 동일하게 절단됨 — 서로 다른 값인데 같은 코드 생성)
--   Stage의 member_code_sequences(member_type='BC', year_month='2608')가 다달이 누적된 테스트
--   가입으로 이미 1071까지 진행돼 있었고, 그 중 3자리로 이미 발급된 실제 코드(CSBC2608107 등,
--   현재도 14건 존재 — 대부분 과거 테스트 계정)와 새로 절단되어 생성된 코드가 충돌한 것.
--   이 결함은 회원코드 코드조합 기준설정 기능(migration 274/276)과 무관하게 원래부터 있었으나,
--   지금까지는 카운터가 999를 넘은 적이 없어 발현되지 않았다가 이번 세션 중 처음 노출됨 —
--   일괄재발급뿐 아니라 override 없는 평범한 신규 B2C 가입(기본 BC 카운터 공유)도 같은 위험에
--   노출돼 있었음(전수는 아니고 10개 단위 구간 중 이미 사용된 3자리 코드와 겹치는 경우만
--   간헐적으로 실패 — 이번 발견 시점 기준 실제 겹치는 구간이 최소 1개 존재해 재현됨).
--
-- 수정: LPAD 목표 길이를 GREATEST(3, 실제 자릿수)로 계산 — 3자리 미만이면 기존과 동일하게
-- '0'으로 패딩, 3자리 이상이면 원래 자릿수를 그대로 유지해 절단이 원천적으로 불가능해진다.
-- 예) v_seq=7 → '007'(기존과 동일) / v_seq=1071 → '1071'(절단 없이 4자리 그대로 유지)
-- → 코드 형식이 "항상 3자리"에서 "카운터가 3자리를 넘으면 자연히 늘어남"으로 바뀌지만, 이는
-- products.md의 상품코드 채번(자릿수 초과 시 자연 확장)과 동일한 안전한 관례이며, 무엇보다
-- 중복 발급(실제 회원가입 실패)보다 코드 자릿수가 늘어나는 쪽이 훨씬 안전하다.

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

  IF p_category_code_override IS NOT NULL AND p_category_code_override <> '' THEN
    v_type_code := p_category_code_override;
  ELSE
    v_type_code := CASE p_member_type WHEN 'B2C' THEN 'BC' ELSE 'BB' END;
  END IF;

  v_year_month := CASE WHEN p_use_yymm THEN TO_CHAR(NOW(), 'YYMM') ELSE 'all' END;

  INSERT INTO member_code_sequences (member_type, year_month, next_seq)
    VALUES (v_type_code, v_year_month, 2)
    ON CONFLICT (member_type, year_month) DO UPDATE
    SET next_seq = member_code_sequences.next_seq + 1
    RETURNING next_seq - 1 INTO v_seq;

  -- ⛔ LPAD(v_seq::TEXT, 3, '0') 절대 금지 — v_seq가 1000 이상이면 오른쪽 절단으로 중복코드
  -- 발생(migration 277에서 실제 재현·수정). 목표 길이를 GREATEST(3, 실제 자릿수)로 계산해
  -- 절단 자체가 불가능하도록 만든다.
  v_seq_str := LPAD(v_seq::TEXT, GREATEST(3, LENGTH(v_seq::TEXT)), '0');
  v_code    := 'CS' || v_type_code ||
               CASE WHEN p_use_yymm THEN v_year_month ELSE '' END ||
               v_seq_str;

  RETURN v_code;
END;
$$;

COMMENT ON FUNCTION public.generate_member_code(TEXT, BOOLEAN, TEXT) IS
  '회원 코드 채번 — p_category_code_override 지정 시 그 접두어 사용(코드조합 기준설정),
   미지정 시 기존 B2C→BC/B2B→BB 하드코딩 폴백(하위호환). 순번은 3자리 기본이며 카운터가
   1000 이상으로 커지면 절단 없이 자릿수가 자연 확장된다(migration 277, LPAD 절단버그 수정).';

REVOKE ALL ON FUNCTION public.generate_member_code(TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.generate_member_code(TEXT, BOOLEAN, TEXT) TO service_role;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- migration 276 적용 직후 상태(LPAD(v_seq::TEXT, 3, '0') 원복)로 CREATE OR REPLACE
-- ⚠️ 롤백 시 next_seq가 이미 1000을 넘은 (member_type, year_month) 조합이 있으면 절단버그가
--   즉시 재발한다 — 롤백 전 반드시 member_code_sequences.next_seq > 999인 행이 없는지 확인.
-- ============================================================
