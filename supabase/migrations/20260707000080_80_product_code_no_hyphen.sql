-- Migration #80: product_code 포맷 변경 (하이픈 전체 제거) + 전체 재발행
-- 변경 전: CS-CAM-2607-001
-- 변경 후: CSCAM2607001

-- ── 1. generate_product_code (2-param) 업데이트 ─────────────────────────────
CREATE OR REPLACE FUNCTION generate_product_code(
  p_product_id UUID,
  p_category   TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_taxonomy_code_id UUID;
  v_cat_code         TEXT;
  v_code_rule        JSONB;
  v_format           JSONB;
  v_prefix           TEXT;
  v_date_format      TEXT;
  v_seq_digits       INT;
  v_reset_monthly    BOOLEAN;
  v_suffix           TEXT;
  v_year_month       TEXT;
  v_seq              INT;
  v_seq_padded       TEXT;
  v_product_code     TEXT;
BEGIN
  -- Step 1: category_taxonomy_map 경유 분류 코드 조회
  SELECT ctm.taxonomy_code_id
  INTO   v_taxonomy_code_id
  FROM   category_taxonomy_map ctm
  WHERE  ctm.product_category = p_category
  ORDER  BY ctm.priority DESC
  LIMIT  1;

  IF v_taxonomy_code_id IS NOT NULL THEN
    SELECT pcc.code, pcc.code_rule
    INTO   v_cat_code, v_code_rule
    FROM   product_category_codes pcc
    WHERE  pcc.id         = v_taxonomy_code_id
      AND  pcc.is_active  = TRUE
      AND  pcc.deleted_at IS NULL;
  END IF;

  -- Fallback 1: product_category_codes.product_category 직접 조회
  IF v_cat_code IS NULL THEN
    SELECT pcc.code, pcc.code_rule
    INTO   v_cat_code, v_code_rule
    FROM   product_category_codes pcc
    WHERE  pcc.product_category = p_category
      AND  pcc.depth            = 0
      AND  pcc.is_active        = TRUE
      AND  pcc.deleted_at       IS NULL
    LIMIT  1;
  END IF;

  -- Fallback 2: 카테고리명 앞 3자리 대문자
  IF v_cat_code IS NULL THEN
    v_cat_code := UPPER(LEFT(p_category, 3));
  END IF;

  -- Step 2: cms_settings 코드 포맷 읽기
  SELECT cs.value
  INTO   v_format
  FROM   cms_settings cs
  WHERE  cs.key = 'reservation_code_format';

  IF v_format IS NULL THEN
    v_format := '{"prefix":"CS","date_format":"YYMM","seq_digits":3,"reset_monthly":true,"suffix":""}'::JSONB;
  END IF;

  IF v_code_rule IS NOT NULL THEN
    v_format := v_format || v_code_rule;
  END IF;

  v_prefix        := COALESCE(NULLIF(v_format->>'prefix',      ''), 'CS');
  v_date_format   := COALESCE(v_format->>'date_format',  'YYMM');
  v_seq_digits    := COALESCE((v_format->>'seq_digits')::INT,   3);
  v_reset_monthly := COALESCE((v_format->>'reset_monthly')::BOOLEAN, TRUE);
  v_suffix        := COALESCE(v_format->>'suffix', '');

  -- Step 3: 날짜 키
  IF v_date_format = 'YYYYMM' THEN
    v_year_month := TO_CHAR(NOW(), 'YYYYMM');
  ELSE
    v_year_month := TO_CHAR(NOW(), 'YYMM');
  END IF;
  IF NOT v_reset_monthly THEN v_year_month := 'all'; END IF;

  -- Step 4: 시퀀스 채번 (atomic)
  INSERT INTO product_code_sequences (category_code, year_month, next_seq)
  VALUES (v_cat_code, v_year_month, 2)
  ON CONFLICT (category_code, year_month)
  DO UPDATE SET next_seq = product_code_sequences.next_seq + 1
  RETURNING product_code_sequences.next_seq - 1 INTO v_seq;

  IF v_seq IS NULL THEN v_seq := 1; END IF;

  -- Step 5: seq 패딩
  v_seq_padded := LPAD(v_seq::TEXT, v_seq_digits, '0');

  -- Step 6: 품번 조합 (하이픈 없음)
  IF v_suffix <> '' THEN
    v_product_code := v_prefix || v_cat_code || v_year_month || v_seq_padded || v_suffix;
  ELSE
    v_product_code := v_prefix || v_cat_code || v_year_month || v_seq_padded;
  END IF;

  -- Step 7: products 업데이트
  UPDATE products
  SET    product_code = v_product_code
  WHERE  id = p_product_id;

  RETURN v_product_code;
END;
$$;

REVOKE ALL ON FUNCTION generate_product_code(UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION generate_product_code(UUID, TEXT) TO service_role;


-- ── 2. generate_product_code (3-param, p_code_id) 업데이트 ──────────────────
CREATE OR REPLACE FUNCTION generate_product_code(
  p_product_id UUID,
  p_category   TEXT,
  p_code_id    UUID DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_taxonomy_code_id UUID;
  v_cat_code         TEXT;
  v_code_rule        JSONB;
  v_format           JSONB;
  v_prefix           TEXT;
  v_date_format      TEXT;
  v_seq_digits       INT;
  v_reset_monthly    BOOLEAN;
  v_suffix           TEXT;
  v_year_month       TEXT;
  v_seq              INT;
  v_seq_padded       TEXT;
  v_product_code     TEXT;
BEGIN
  -- Step 1: p_code_id 직접 지정 시 taxonomy_map 스킵
  IF p_code_id IS NOT NULL THEN
    SELECT pcc.code, pcc.code_rule
    INTO   v_cat_code, v_code_rule
    FROM   product_category_codes pcc
    WHERE  pcc.id         = p_code_id
      AND  pcc.is_active  = TRUE
      AND  pcc.deleted_at IS NULL;

    IF v_cat_code IS NULL THEN
      p_code_id := NULL;
    END IF;
  END IF;

  IF p_code_id IS NULL THEN
    SELECT ctm.taxonomy_code_id
    INTO   v_taxonomy_code_id
    FROM   category_taxonomy_map ctm
    WHERE  ctm.product_category = p_category
    ORDER  BY ctm.priority DESC
    LIMIT  1;

    IF v_taxonomy_code_id IS NOT NULL THEN
      SELECT pcc.code, pcc.code_rule
      INTO   v_cat_code, v_code_rule
      FROM   product_category_codes pcc
      WHERE  pcc.id         = v_taxonomy_code_id
        AND  pcc.is_active  = TRUE
        AND  pcc.deleted_at IS NULL;
    END IF;

    IF v_cat_code IS NULL THEN
      SELECT pcc.code, pcc.code_rule
      INTO   v_cat_code, v_code_rule
      FROM   product_category_codes pcc
      WHERE  pcc.product_category = p_category
        AND  pcc.depth            = 0
        AND  pcc.is_active        = TRUE
        AND  pcc.deleted_at       IS NULL
      LIMIT  1;
    END IF;

    IF v_cat_code IS NULL THEN
      v_cat_code := UPPER(LEFT(p_category, 3));
    END IF;
  END IF;

  -- Step 2: 포맷 읽기
  SELECT cs.value
  INTO   v_format
  FROM   cms_settings cs
  WHERE  cs.key = 'reservation_code_format';

  IF v_format IS NULL THEN
    v_format := '{"prefix":"CS","date_format":"YYMM","seq_digits":3,"reset_monthly":true,"suffix":""}'::JSONB;
  END IF;

  IF v_code_rule IS NOT NULL THEN
    v_format := v_format || v_code_rule;
  END IF;

  v_prefix        := COALESCE(NULLIF(v_format->>'prefix',      ''), 'CS');
  v_date_format   := COALESCE(v_format->>'date_format',  'YYMM');
  v_seq_digits    := COALESCE((v_format->>'seq_digits')::INT,   3);
  v_reset_monthly := COALESCE((v_format->>'reset_monthly')::BOOLEAN, TRUE);
  v_suffix        := COALESCE(v_format->>'suffix', '');

  -- Step 3: 날짜 키
  IF v_date_format = 'YYYYMM' THEN
    v_year_month := TO_CHAR(NOW(), 'YYYYMM');
  ELSE
    v_year_month := TO_CHAR(NOW(), 'YYMM');
  END IF;
  IF NOT v_reset_monthly THEN v_year_month := 'all'; END IF;

  -- Step 4: 시퀀스 채번
  INSERT INTO product_code_sequences (category_code, year_month, next_seq)
  VALUES (v_cat_code, v_year_month, 2)
  ON CONFLICT (category_code, year_month)
  DO UPDATE SET next_seq = product_code_sequences.next_seq + 1
  RETURNING product_code_sequences.next_seq - 1 INTO v_seq;

  IF v_seq IS NULL THEN v_seq := 1; END IF;

  -- Step 5: 패딩
  v_seq_padded := LPAD(v_seq::TEXT, v_seq_digits, '0');

  -- Step 6: 품번 조합 (하이픈 없음)
  IF v_suffix <> '' THEN
    v_product_code := v_prefix || v_cat_code || v_year_month || v_seq_padded || v_suffix;
  ELSE
    v_product_code := v_prefix || v_cat_code || v_year_month || v_seq_padded;
  END IF;

  -- Step 7: products 업데이트
  UPDATE products
  SET    product_code = v_product_code
  WHERE  id = p_product_id;

  RETURN v_product_code;
END;
$$;

REVOKE ALL ON FUNCTION generate_product_code(UUID, TEXT, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION generate_product_code(UUID, TEXT, UUID) TO service_role;


-- ── 3. 기존 품번 NULL 처리 ────────────────────────────────────────────────────
UPDATE products
SET product_code = NULL
WHERE product_code IS NOT NULL;

-- ── 4. 시퀀스 초기화 (재발행 시 001부터 재시작) ─────────────────────────────
DELETE FROM product_code_sequences;

-- ── 5. 전체 재발행 (created_at ASC → 오래된 상품이 낮은 번호) ──────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, category
    FROM   products
    WHERE  product_code IS NULL
      AND  deleted_at   IS NULL
    ORDER  BY created_at ASC
  LOOP
    PERFORM generate_product_code(r.id, r.category);
  END LOOP;
END $$;
