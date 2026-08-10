-- Migration #216: generate_inventory_product_code — 2단 계층 채번 모드 분기 추가
-- 설계: 시그니처 불변(UUID, UUID), 내부 로직만 분기 (2026-08-10)
--
-- 분기 기준: 부모 code_series에 'parent_seq_digits' 키가 있으면 2단 모드
--   ■ 2단 모드: product_child_sequences_by_parent에서 순번2(자식) 채번 (1부터 시작)
--     품번 = prefix + cat_code + date_part + LPAD(parent_seq, parent_seq_digits) + LPAD(child_seq, seq_digits)
--   ■ 기존 모드: product_code_sequences에서 기존과 완전히 동일한 로직 (회귀 없음)
--
-- 순번2(자식)는 1부터 시작 (기존 1개-순번 모드와 동일한 관례)
--   - 첫 번째 빠른재고등록 = 001, 두 번째 = 002, ...
--   - 레거시 폴백(code_series 없이 product_code만 있는 부모)은 기존 로직 그대로
--
-- max_sequence 상한 체크:
--   2단 모드: code_series.max_sequence가 순번2 상한 (NULL이면 상한 없음)
--   기존 모드: 기존 동일 동작 (NULL이면 상한 없음)

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
  v_parent_series      JSONB;
  v_parent_code        TEXT;
  v_cat_code           TEXT;
  v_year_month         TEXT;
  v_prefix             TEXT;
  v_suffix             TEXT;
  v_seq_digits         INT;
  v_max_sequence       INT;
  v_date_part          TEXT;
  v_seq                INT;
  v_seq_padded         TEXT;
  v_child_code         TEXT;
  -- 2단 모드 전용
  v_parent_seq         INT;
  v_parent_seq_digits  INT;
  v_parent_seq_padded  TEXT;
  v_parent_max_seq     INT;
  v_is_two_tier        BOOLEAN := FALSE;
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
    -- ────────────────────────────────────────────────────────────────────────
    -- 신규 경로: code_series JSON에서 채번 구조 추출
    -- ────────────────────────────────────────────────────────────────────────
    v_cat_code     := v_parent_series->>'category_code';
    v_year_month   := v_parent_series->>'year_month';
    v_prefix       := COALESCE(NULLIF(v_parent_series->>'prefix', ''), 'CS');
    v_suffix       := COALESCE(v_parent_series->>'suffix', '');
    v_seq_digits   := COALESCE((v_parent_series->>'seq_digits')::INT, 3);
    v_max_sequence := (v_parent_series->>'max_sequence')::INT;  -- NULL 허용
    v_date_part    := CASE WHEN v_year_month = 'nodate' OR v_year_month IS NULL
                           THEN '' ELSE v_year_month END;

    -- 2단 모드 판별: parent_seq_digits 키 존재 여부 확인
    IF v_parent_series ? 'parent_seq_digits' THEN
      v_is_two_tier      := TRUE;
      v_parent_seq       := (v_parent_series->>'parent_seq')::INT;
      v_parent_seq_digits := (v_parent_series->>'parent_seq_digits')::INT;
      v_parent_max_seq   := (v_parent_series->>'parent_max_sequence')::INT;  -- NULL 허용
    END IF;

  ELSIF v_parent_code IS NOT NULL THEN
    -- ────────────────────────────────────────────────────────────────────────
    -- 레거시 폴백: 부모의 기존 product_code 문자열에서 채번 구조 역산
    -- (migration 194 원본 로직 — 2단 모드는 레거시 부모에 적용 안 됨)
    -- ────────────────────────────────────────────────────────────────────────
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
    v_max_sequence := NULL;
    v_is_two_tier  := FALSE;

  ELSE
    RAISE EXCEPTION '부모 상품의 품번 체계가 설정되지 않았습니다. (parent_product_id: %)', p_parent_product_id;
  END IF;

  -- ────────────────────────────────────────────────────────────────────────────
  -- 2단 모드: product_child_sequences_by_parent에서 순번2 채번 (1부터 시작)
  -- ────────────────────────────────────────────────────────────────────────────
  IF v_is_two_tier THEN

    INSERT INTO product_child_sequences_by_parent (parent_product_id, next_seq)
    VALUES (p_parent_product_id, 2)
    ON CONFLICT (parent_product_id)
    DO UPDATE SET next_seq = product_child_sequences_by_parent.next_seq + 1
    RETURNING product_child_sequences_by_parent.next_seq - 1 INTO v_seq;
    IF v_seq IS NULL THEN v_seq := 1; END IF;

    -- 순번2 상한 초과 체크 (max_sequence, NULL이면 무제한)
    IF v_max_sequence IS NOT NULL AND v_seq > v_max_sequence THEN
      RAISE EXCEPTION 'max_sequence_exceeded: 이 부모(%)의 재고 순번 상한(%)에 도달했습니다. 코드설정에서 순번2 상한을 늘려주세요.',
        p_parent_product_id, v_max_sequence
        USING ERRCODE = 'P0001';
    END IF;

    -- 품번 조합: prefix + cat_code + date_part + parent_seq_padded + child_seq_padded
    v_parent_seq_padded := LPAD(v_parent_seq::TEXT, v_parent_seq_digits, '0');
    v_seq_padded        := LPAD(v_seq::TEXT, v_seq_digits, '0');
    IF v_suffix <> '' THEN
      v_child_code := v_prefix || v_cat_code || v_date_part || v_parent_seq_padded || v_seq_padded || v_suffix;
    ELSE
      v_child_code := v_prefix || v_cat_code || v_date_part || v_parent_seq_padded || v_seq_padded;
    END IF;

  -- ────────────────────────────────────────────────────────────────────────────
  -- 기존 모드: product_code_sequences에서 채번 (migration 194와 동일 — 회귀 없음)
  -- ────────────────────────────────────────────────────────────────────────────
  ELSE

    INSERT INTO product_code_sequences (category_code, year_month, next_seq)
    VALUES (v_cat_code, COALESCE(v_year_month, 'nodate'), 2)
    ON CONFLICT (category_code, year_month)
    DO UPDATE SET next_seq = product_code_sequences.next_seq + 1
    RETURNING product_code_sequences.next_seq - 1 INTO v_seq;
    IF v_seq IS NULL THEN v_seq := 1; END IF;

    IF v_max_sequence IS NOT NULL AND v_seq > v_max_sequence THEN
      RAISE EXCEPTION 'max_sequence_exceeded: 이 품번 체계(%)의 순번 상한(%)에 도달했습니다. 관리자에게 문의하거나 max_sequence를 늘려주세요.',
        v_cat_code, v_max_sequence
        USING ERRCODE = 'P0001';
    END IF;

    v_seq_padded := LPAD(v_seq::TEXT, v_seq_digits, '0');
    IF v_suffix <> '' THEN
      v_child_code := v_prefix || v_cat_code || v_date_part || v_seq_padded || v_suffix;
    ELSE
      v_child_code := v_prefix || v_cat_code || v_date_part || v_seq_padded;
    END IF;

  END IF;

  -- 자식 product_code 기록
  UPDATE products SET product_code = v_child_code WHERE id = p_product_id;

  RETURN v_child_code;
END;
$$;

COMMENT ON FUNCTION public.generate_inventory_product_code(UUID, UUID) IS
  '빠른 재고 등록 전용. code_series에 parent_seq_digits가 있으면 2단 모드:
   product_child_sequences_by_parent(부모 기준 독립 카운터, 1부터 시작)에서 순번2 채번
   → prefix + cat_code + date_part + parent_seq + child_seq 구조.
   그 외(1단/레거시)는 기존 product_code_sequences 경유 로직 완전 유지 (Migration 194 회귀 없음).';

REVOKE ALL ON FUNCTION public.generate_inventory_product_code(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.generate_inventory_product_code(UUID, UUID) TO service_role;
