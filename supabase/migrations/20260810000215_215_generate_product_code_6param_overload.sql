-- Migration #215: generate_product_code 6-param 오버로드 신규 추가
-- 설계: 순번 2단 계층 채번 — 부모 등록 시 순번1 고정 채번 (2026-08-10)
--
-- 기존 2/3/5-param 오버로드는 무변경 (시그니처 절대 불변 — products.md §2-3)
-- 신규 6-param은 p_parent_max_sequence 파라미터만 추가된 버전
--
-- 동작:
--   ① 기존 5-param과 동일하게 category_code / format / year_month 결정
--   ② product_parent_sequences에서 순번1(parent_seq)을 원자적으로 소비 (1부터 시작)
--   ③ code_series에 parent_seq / parent_seq_digits / parent_max_sequence 추가 저장
--   ④ max_sequence(순번2 상한)도 함께 저장 (NULL 허용 — migration 213 반영)
--
-- 호출 조건 (TypeScript 측):
--   combo 아이템의 parent_max_sequence IS NOT NULL 인 경우에만 이 6-param 오버로드 호출
--   NULL인 경우에는 기존 5-param 경로 그대로 유지

CREATE OR REPLACE FUNCTION public.generate_product_code(
  p_product_id          UUID,
  p_category            TEXT,
  p_code_id             UUID,
  p_date_option         TEXT,     -- 콤보 행의 date_option: 'none' | 'ym' | 'ymd'
  p_max_sequence        INT,      -- 순번2(자식) 상한 (NULL 허용 — NULLABLE 완화됨)
  p_parent_max_sequence INT       -- 순번1(부모) 상한 (신규 파라미터)
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

  -- ① 카테고리코드 결정 (p_code_id 지정 시 직접 사용 — 5-param과 동일)
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

  -- ② 포맷 결정 (prefix, seq_digits, suffix 추출용 — 5-param과 동일)
  SELECT cs.value INTO v_format
  FROM cms_settings cs WHERE cs.key = 'reservation_code_format';
  IF v_format IS NULL THEN
    v_format := '{"prefix":"CS","date_format":"YYMM","seq_digits":3,"reset_monthly":true,"suffix":""}'::JSONB;
  END IF;
  IF v_code_rule IS NOT NULL THEN v_format := v_format || v_code_rule; END IF;

  v_prefix     := COALESCE(NULLIF(v_format->>'prefix', ''), 'CS');
  v_seq_digits := COALESCE((v_format->>'seq_digits')::INT, 3);
  v_suffix     := COALESCE(v_format->>'suffix', '');

  -- ③ date_option → 시퀀스 키 결정 (5-param과 동일)
  CASE p_date_option
    WHEN 'none' THEN v_year_month := 'nodate';
    WHEN 'ymd'  THEN v_year_month := TO_CHAR(NOW(), 'YYMMDD');
    ELSE             v_year_month := TO_CHAR(NOW(), 'YYMM');
  END CASE;

  -- ④ 순번1(부모) 상한 도달 체크 + parent_seq_digits 결정
  --    parent_seq_digits: p_parent_max_sequence 자릿수 (없으면 seq_digits와 동일)
  IF p_parent_max_sequence IS NOT NULL THEN
    v_parent_seq_digits := LENGTH(p_parent_max_sequence::TEXT);
  ELSE
    v_parent_seq_digits := v_seq_digits;
  END IF;

  -- ⑤ 순번1(부모) 원자적 채번 — product_parent_sequences에서 소비 (1부터 시작)
  INSERT INTO product_parent_sequences (category_code, year_month, next_seq)
  VALUES (v_cat_code, COALESCE(v_year_month, 'nodate'), 2)
  ON CONFLICT (category_code, year_month)
  DO UPDATE SET next_seq = product_parent_sequences.next_seq + 1
  RETURNING product_parent_sequences.next_seq - 1 INTO v_parent_seq;
  IF v_parent_seq IS NULL THEN v_parent_seq := 1; END IF;

  -- ⑥ 순번1 상한 초과 체크
  IF p_parent_max_sequence IS NOT NULL AND v_parent_seq > p_parent_max_sequence THEN
    RAISE EXCEPTION 'parent_max_sequence_exceeded: 이 조합코드(%)의 부모 순번 상한(%)에 도달했습니다. 코드설정에서 순번1 상한을 늘려주세요.',
      v_cat_code, p_parent_max_sequence
      USING ERRCODE = 'P0001';
  END IF;

  -- ⑦ code_series 저장 — 기존 필드 + 2단 모드 신규 필드
  UPDATE products
  SET code_series = jsonb_build_object(
    'category_code',       v_cat_code,
    'year_month',          v_year_month,
    'prefix',              v_prefix,
    'suffix',              v_suffix,
    'seq_digits',          v_seq_digits,
    'max_sequence',        p_max_sequence,      -- 순번2(자식) 상한, NULL 허용
    'parent_seq',          v_parent_seq,        -- 신규: 고정 채번된 순번1 값
    'parent_seq_digits',   v_parent_seq_digits, -- 신규: 순번1 자릿수
    'parent_max_sequence', p_parent_max_sequence -- 신규: 순번1 상한
  )
  WHERE id = p_product_id;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_product_code(UUID, TEXT, UUID, TEXT, INT, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.generate_product_code(UUID, TEXT, UUID, TEXT, INT, INT) TO service_role;

COMMENT ON FUNCTION public.generate_product_code(UUID, TEXT, UUID, TEXT, INT, INT) IS
  '6-param 오버로드: 2단 계층 채번(순번1=부모, 순번2=자식)을 위해 p_parent_max_sequence 파라미터 추가.
   순번1(부모)은 product_parent_sequences에서 1부터 원자적 채번 후 code_series에 고정 기록.
   순번2(자식)는 generate_inventory_product_code가 product_child_sequences_by_parent에서 1부터 채번.
   기존 2/3/5-param 오버로드는 무변경.';
