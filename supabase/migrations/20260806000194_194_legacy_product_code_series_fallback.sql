-- Migration #194: generate_inventory_product_code — 레거시 부모(품번은 있으나 code_series 없음) 대응
--
-- 배경: Migration 193으로 부모=code_series(구조저장)/자식=실채번 구조로 전환했으나,
--       193 이전에 이미 product_code를 발급받은 기존 '부모' 상품들은 code_series가 NULL이라
--       "빠른 재고 등록"이 전부 막히는 문제가 있었음(Stephen 확인 후 옵션 B 선택).
--
-- 해결: code_series가 NULL이지만 기존 product_code는 있는 부모(레거시)인 경우,
--       그 product_code 문자열을 파싱해 채번 구조를 그 자리에서 역산 — 기존 데이터는 손대지 않음
--       (products.product_code/code_series 컬럼 값 자체를 백필하지 않음, 매 호출 시 즉석 파싱만).
--       파싱 로직은 migration 99(이 정책 이전의 generate_inventory_product_code)의 방식을 그대로 재사용.
--
-- code_series도 없고 product_code도 없는 부모(정말로 아무 채번 구조가 없는 경우)만 예외 발생.

CREATE OR REPLACE FUNCTION public.generate_inventory_product_code(
  p_product_id        UUID,
  p_parent_product_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_series JSONB;
  v_parent_code   TEXT;   -- 레거시 폴백용 부모 product_code
  v_cat_code      TEXT;
  v_year_month    TEXT;
  v_prefix        TEXT;
  v_suffix        TEXT;
  v_seq_digits    INT;
  v_max_sequence  INT;
  v_date_part     TEXT;
  v_seq           INT;
  v_seq_padded    TEXT;
  v_child_code    TEXT;
BEGIN
  -- Guard: 자식 자신의 product_code가 이미 있으면 그대로 반환
  SELECT product_code INTO v_child_code
  FROM products WHERE id = p_product_id;
  IF v_child_code IS NOT NULL THEN RETURN v_child_code; END IF;

  -- 부모의 code_series JSONB + product_code(레거시 폴백용) 동시 조회
  SELECT code_series, product_code INTO v_parent_series, v_parent_code
  FROM products
  WHERE id = p_parent_product_id AND deleted_at IS NULL;

  IF v_parent_series IS NOT NULL THEN
    -- ── 신규 경로: code_series JSON에서 채번 구조 추출 ──────────────────
    v_cat_code     := v_parent_series->>'category_code';
    v_year_month   := v_parent_series->>'year_month';
    v_prefix       := COALESCE(NULLIF(v_parent_series->>'prefix', ''), 'CS');
    v_suffix       := COALESCE(v_parent_series->>'suffix', '');
    v_seq_digits   := COALESCE((v_parent_series->>'seq_digits')::INT, 3);
    v_max_sequence := (v_parent_series->>'max_sequence')::INT;
    v_date_part    := CASE WHEN v_year_month = 'nodate' OR v_year_month IS NULL
                           THEN '' ELSE v_year_month END;

  ELSIF v_parent_code IS NOT NULL THEN
    -- ── 레거시 폴백: 부모의 기존 product_code 문자열에서 채번 구조 역산 ──
    --    (migration 99 원본 로직 재사용 — prefix는 항상 'CS' 고정 관례)
    SELECT pcs.category_code, pcs.year_month
    INTO   v_cat_code, v_year_month
    FROM   product_code_sequences pcs
    WHERE  v_parent_code LIKE
             'CS' || pcs.category_code ||
             CASE WHEN pcs.year_month = 'nodate' THEN '' ELSE pcs.year_month END || '%'
    ORDER  BY LENGTH(
               'CS' || pcs.category_code ||
               CASE WHEN pcs.year_month = 'nodate' THEN '' ELSE pcs.year_month END
             ) DESC
    LIMIT  1;

    IF v_cat_code IS NULL THEN
      RAISE EXCEPTION '부모 품번(%)에 해당하는 채번 체계를 찾을 수 없습니다. product_code_sequences를 확인해주세요.', v_parent_code;
    END IF;

    v_prefix     := 'CS';
    v_suffix     := '';
    v_date_part  := CASE WHEN v_year_month = 'nodate' THEN '' ELSE v_year_month END;
    v_seq_digits := LENGTH(v_parent_code) - 2 - LENGTH(v_cat_code) - LENGTH(v_date_part);
    IF v_seq_digits < 1 THEN v_seq_digits := 3; END IF;
    v_max_sequence := NULL;  -- 레거시 품번엔 순번상한 개념 없음

  ELSE
    RAISE EXCEPTION '부모 상품의 품번 체계가 설정되지 않았습니다. (parent_product_id: %)', p_parent_product_id;
  END IF;

  -- ④ 원자적 순번 증가 (시퀀스 키는 신규/레거시 경로 공통 — category_code + year_month)
  INSERT INTO product_code_sequences (category_code, year_month, next_seq)
  VALUES (v_cat_code, COALESCE(v_year_month, 'nodate'), 2)
  ON CONFLICT (category_code, year_month)
  DO UPDATE SET next_seq = product_code_sequences.next_seq + 1
  RETURNING product_code_sequences.next_seq - 1 INTO v_seq;
  IF v_seq IS NULL THEN v_seq := 1; END IF;

  -- max_sequence 초과 체크 (설정된 경우에만 — 레거시 경로는 항상 NULL이라 스킵)
  IF v_max_sequence IS NOT NULL AND v_seq > v_max_sequence THEN
    RAISE EXCEPTION 'max_sequence_exceeded: 이 품번 체계(%)의 순번 상한(%)에 도달했습니다. 관리자에게 문의하거나 max_sequence를 늘려주세요.',
      v_cat_code, v_max_sequence
      USING ERRCODE = 'P0001';
  END IF;

  -- ⑤ 품번 문자열 조합
  v_seq_padded := LPAD(v_seq::TEXT, v_seq_digits, '0');
  IF v_suffix <> '' THEN
    v_child_code := v_prefix || v_cat_code || v_date_part || v_seq_padded || v_suffix;
  ELSE
    v_child_code := v_prefix || v_cat_code || v_date_part || v_seq_padded;
  END IF;

  -- ⑥ 자식 product_code 기록
  UPDATE products SET product_code = v_child_code WHERE id = p_product_id;

  RETURN v_child_code;
END;
$$;

COMMENT ON FUNCTION public.generate_inventory_product_code(UUID, UUID) IS
  '빠른 재고 등록 전용: 부모의 code_series(신규) 또는 기존 product_code 문자열 역산(레거시 폴백)으로
   채번 구조를 얻어 동일 체계로 자식 품번을 순번 채번한다. 레거시 부모의 product_code/code_series
   컬럼 자체는 백필하지 않음 — 매 호출 시 즉석 역산만 수행(Migration 194, GATE C 옵션 B 확정).';
