-- Migration #222: generate_product_code 7-param 오버로드 신규 추가
-- 설계: 조합코드(combo) 분류코드 합산 채번 버그 수정 (2026-08-12)
--
-- 버그 원인:
--   기존 new/+page.server.ts는 콤보 내 여러 코드 중 depth가 가장 높은 1개만
--   p_code_id로 전달 → code_series.category_code에 단일 코드만 저장됨.
--   반면 미리보기(comboCatCodeStr)는 전체 코드를 TIER_ORDER(대→중→소)로 합산 표시
--   → 미리보기와 실제 채번값 불일치.
--
-- 수정:
--   신규 p_category_code_override 파라미터로 합산된 분류코드 문자열을 직접 지정.
--   p_code_id는 code_rule(prefix/format 설정) 조회에만 사용.
--
-- 절대 제약:
--   ① 기존 2/3/5/6-param 오버로드 시그니처 무변경 (products.md §2-3, GP-10)
--   ② 이 7-param은 신규 ADD-only (기존 함수 DROP/ALTER 없음)
--   ③ 기존 product_code 재사용/리셋 기능 신설 금지 (§2-2 영구고정 정책)
--
-- TypeScript 호출 시:
--   모든 콤보 경로(기존 3/5/6-param)를 이 7-param 단일 호출로 통일.
--   비-콤보 경로(2-param / p_code_id: null)는 그대로 유지.

CREATE OR REPLACE FUNCTION public.generate_product_code(
  p_product_id              UUID,
  p_category                TEXT,
  p_code_id                 UUID,
  p_date_option             TEXT,     -- 콤보 행의 date_option: 'none' | 'ym' | 'ymd'
  p_max_sequence            INT,      -- 순번2(자식) 상한 (NULL 허용)
  p_parent_max_sequence     INT,      -- 순번1(부모) 상한 (NULL = 무제한)
  p_category_code_override  TEXT      -- 합산 분류코드 (TIER_ORDER 순 대문자 — 예: 'CAMSLR')
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_series     JSONB;
  v_cat_code            TEXT;
  v_code_rule           JSONB;
  v_format              JSONB;
  v_prefix              TEXT;
  v_seq_digits          INT;
  v_suffix              TEXT;
  v_year_month          TEXT;
  v_parent_seq          INT;
  v_parent_seq_digits   INT;
BEGIN
  -- Guard: 이미 code_series가 있으면 재설정 안 함 (구조는 한번 정해지면 고정)
  SELECT code_series INTO v_existing_series
  FROM products WHERE id = p_product_id;
  IF v_existing_series IS NOT NULL THEN
    RETURN NULL;
  END IF;

  -- ① 카테고리코드 결정
  --   p_category_code_override IS NOT NULL → 합산 분류코드를 직접 지정
  --     p_code_id는 code_rule(prefix/format) 조회에만 사용 (v_cat_code 덮어쓰지 않음)
  --   p_category_code_override IS NULL     → 기존 6-param과 동일 경로
  IF p_category_code_override IS NOT NULL THEN
    v_cat_code := p_category_code_override;
    -- 루트 코드(TIER_ORDER 기준 대분류)의 code_rule로 format 결정
    IF p_code_id IS NOT NULL THEN
      SELECT pcc.code_rule INTO v_code_rule
      FROM   product_category_codes pcc
      WHERE  pcc.id = p_code_id
        AND  pcc.is_active = TRUE AND pcc.deleted_at IS NULL;
    END IF;
  ELSE
    -- p_code_id 지정 시 코드 + 규칙 모두 조회 (6-param과 동일)
    IF p_code_id IS NOT NULL THEN
      SELECT pcc.code, pcc.code_rule INTO v_cat_code, v_code_rule
      FROM   product_category_codes pcc
      WHERE  pcc.id = p_code_id
        AND  pcc.is_active = TRUE AND pcc.deleted_at IS NULL;
    END IF;
    IF v_cat_code IS NULL THEN
      SELECT pcc.code, pcc.code_rule INTO v_cat_code, v_code_rule
      FROM   product_category_codes pcc
      WHERE  pcc.product_category = p_category AND pcc.depth = 0
        AND  pcc.is_active = TRUE AND pcc.deleted_at IS NULL
      LIMIT  1;
    END IF;
    IF v_cat_code IS NULL THEN
      v_cat_code := UPPER(LEFT(p_category, 3));
    END IF;
  END IF;

  -- ② 포맷 결정 (prefix, seq_digits, suffix 추출용)
  SELECT cs.value INTO v_format
  FROM cms_settings cs WHERE cs.key = 'reservation_code_format';
  IF v_format IS NULL THEN
    v_format := '{"prefix":"CS","date_format":"YYMM","seq_digits":3,"reset_monthly":true,"suffix":""}'::JSONB;
  END IF;
  IF v_code_rule IS NOT NULL THEN v_format := v_format || v_code_rule; END IF;

  v_prefix     := COALESCE(NULLIF(v_format->>'prefix', ''), 'CS');
  v_seq_digits := COALESCE((v_format->>'seq_digits')::INT, 3);
  v_suffix     := COALESCE(v_format->>'suffix', '');

  -- ③ date_option → year_month 결정
  CASE p_date_option
    WHEN 'none' THEN v_year_month := 'nodate';
    WHEN 'ymd'  THEN v_year_month := TO_CHAR(NOW(), 'YYMMDD');
    ELSE             v_year_month := TO_CHAR(NOW(), 'YYMM');
  END CASE;

  -- ④ 순번1(부모) 모드 분기 — p_parent_max_sequence IS NOT NULL 일 때만 2단 계층 활성화
  --    (기존 6-param은 TS 레이어가 이 조건일 때만 호출했으나, 7-param은 모든 콤보 경로에서
  --     호출되므로 이 함수 내부에서 동일한 분기를 재현해야 1단 모드 회귀를 막을 수 있음)
  IF p_parent_max_sequence IS NOT NULL THEN
    v_parent_seq_digits := LENGTH(p_parent_max_sequence::TEXT);

    -- 순번1(부모) 원자적 채번 — product_parent_sequences에서 소비 (1부터 시작)
    --   키: (v_cat_code, year_month) — 합산 분류코드를 그대로 사용 (예: 'CAMSLR')
    INSERT INTO product_parent_sequences (category_code, year_month, next_seq)
    VALUES (v_cat_code, COALESCE(v_year_month, 'nodate'), 2)
    ON CONFLICT (category_code, year_month)
    DO UPDATE SET next_seq = product_parent_sequences.next_seq + 1
    RETURNING product_parent_sequences.next_seq - 1 INTO v_parent_seq;
    IF v_parent_seq IS NULL THEN v_parent_seq := 1; END IF;

    IF v_parent_seq > p_parent_max_sequence THEN
      RAISE EXCEPTION 'parent_max_sequence_exceeded: 이 조합코드(%)의 부모 순번 상한(%)에 도달했습니다. 코드설정에서 순번1 상한을 늘려주세요.',
        v_cat_code, p_parent_max_sequence
        USING ERRCODE = 'P0001';
    END IF;

    -- code_series 저장 — 2단 계층(6-param과 동일 구조)
    UPDATE products
    SET code_series = jsonb_build_object(
      'category_code',       v_cat_code,
      'year_month',          v_year_month,
      'prefix',              v_prefix,
      'suffix',              v_suffix,
      'seq_digits',          v_seq_digits,
      'max_sequence',        p_max_sequence,
      'parent_seq',          v_parent_seq,
      'parent_seq_digits',   v_parent_seq_digits,
      'parent_max_sequence', p_parent_max_sequence
    )
    WHERE id = p_product_id;
  ELSE
    -- 1단 모드(순번1 미사용) — 기존 5-param과 동일한 code_series 형태(parent_* 키 없음).
    -- product_parent_sequences를 전혀 소비하지 않음 — "기존 1개-순번 모드 100% 무변경" 보장.
    UPDATE products
    SET code_series = jsonb_build_object(
      'category_code', v_cat_code,
      'year_month',    v_year_month,
      'prefix',        v_prefix,
      'suffix',        v_suffix,
      'seq_digits',    v_seq_digits,
      'max_sequence',  p_max_sequence
    )
    WHERE id = p_product_id;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_product_code(UUID, TEXT, UUID, TEXT, INT, INT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.generate_product_code(UUID, TEXT, UUID, TEXT, INT, INT, TEXT) TO service_role;

COMMENT ON FUNCTION public.generate_product_code(UUID, TEXT, UUID, TEXT, INT, INT, TEXT) IS
  '7-param 오버로드: 조합코드(combo) 분류코드 합산 채번 버그 수정.
   p_category_code_override: TIER_ORDER(대→중→소) 정렬 후 합산한 분류코드 문자열 (예: CAMSLR).
   p_code_id: 루트(대분류) 코드 — code_rule(prefix/format) 조회에만 사용.
   모든 콤보 경로(기존 3/5/6-param)를 이 단일 7-param 호출로 통일.
   기존 2/3/5/6-param 오버로드 무변경 (시그니처 절대 불변 — products.md §2-3).';
