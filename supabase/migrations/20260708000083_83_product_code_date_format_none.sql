-- Migration #83: generate_product_code에 date_format='NONE' 지원 추가
-- code_rule.date_format='NONE' 설정 시 년월 파트 생략 → {prefix}{cat}{seq}

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
  SELECT ctm.taxonomy_code_id INTO v_taxonomy_code_id
  FROM   category_taxonomy_map ctm
  WHERE  ctm.product_category = p_category
  ORDER  BY ctm.priority DESC
  LIMIT  1;

  IF v_taxonomy_code_id IS NOT NULL THEN
    SELECT pcc.code, pcc.code_rule INTO v_cat_code, v_code_rule
    FROM   product_category_codes pcc
    WHERE  pcc.id = v_taxonomy_code_id AND pcc.is_active = TRUE AND pcc.deleted_at IS NULL;
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

  SELECT cs.value INTO v_format
  FROM   cms_settings cs WHERE cs.key = 'reservation_code_format';

  IF v_format IS NULL THEN
    v_format := '{"prefix":"CS","date_format":"YYMM","seq_digits":3,"reset_monthly":true,"suffix":""}'::JSONB;
  END IF;

  IF v_code_rule IS NOT NULL THEN
    v_format := v_format || v_code_rule;
  END IF;

  v_prefix        := COALESCE(NULLIF(v_format->>'prefix', ''), 'CS');
  v_date_format   := COALESCE(v_format->>'date_format', 'YYMM');
  v_seq_digits    := COALESCE((v_format->>'seq_digits')::INT, 3);
  v_reset_monthly := COALESCE((v_format->>'reset_monthly')::BOOLEAN, TRUE);
  v_suffix        := COALESCE(v_format->>'suffix', '');

  -- date_format='NONE' → 년월 파트 생략
  IF v_date_format = 'NONE' THEN
    v_year_month := '';
  ELSIF v_date_format = 'YYYYMM' THEN
    v_year_month := TO_CHAR(NOW(), 'YYYYMM');
  ELSE
    v_year_month := TO_CHAR(NOW(), 'YYMM');
  END IF;

  IF v_date_format <> 'NONE' AND NOT v_reset_monthly THEN
    v_year_month := 'all';
  END IF;

  -- seq 채번 키: 날짜없으면 'nodate' 고정 키 사용
  INSERT INTO product_code_sequences (category_code, year_month, next_seq)
  VALUES (v_cat_code, CASE WHEN v_year_month = '' THEN 'nodate' ELSE v_year_month END, 2)
  ON CONFLICT (category_code, year_month)
  DO UPDATE SET next_seq = product_code_sequences.next_seq + 1
  RETURNING product_code_sequences.next_seq - 1 INTO v_seq;

  IF v_seq IS NULL THEN v_seq := 1; END IF;

  v_seq_padded := LPAD(v_seq::TEXT, v_seq_digits, '0');

  IF v_suffix <> '' THEN
    v_product_code := v_prefix || v_cat_code || v_year_month || v_seq_padded || v_suffix;
  ELSE
    v_product_code := v_prefix || v_cat_code || v_year_month || v_seq_padded;
  END IF;

  UPDATE products SET product_code = v_product_code WHERE id = p_product_id;
  RETURN v_product_code;
END;
$$;

REVOKE ALL ON FUNCTION generate_product_code(UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION generate_product_code(UUID, TEXT) TO service_role;


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
  IF p_code_id IS NOT NULL THEN
    SELECT pcc.code, pcc.code_rule INTO v_cat_code, v_code_rule
    FROM   product_category_codes pcc
    WHERE  pcc.id = p_code_id AND pcc.is_active = TRUE AND pcc.deleted_at IS NULL;
    IF v_cat_code IS NULL THEN p_code_id := NULL; END IF;
  END IF;

  IF p_code_id IS NULL THEN
    SELECT ctm.taxonomy_code_id INTO v_taxonomy_code_id
    FROM   category_taxonomy_map ctm
    WHERE  ctm.product_category = p_category
    ORDER  BY ctm.priority DESC LIMIT 1;

    IF v_taxonomy_code_id IS NOT NULL THEN
      SELECT pcc.code, pcc.code_rule INTO v_cat_code, v_code_rule
      FROM   product_category_codes pcc
      WHERE  pcc.id = v_taxonomy_code_id AND pcc.is_active = TRUE AND pcc.deleted_at IS NULL;
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

  SELECT cs.value INTO v_format
  FROM   cms_settings cs WHERE cs.key = 'reservation_code_format';

  IF v_format IS NULL THEN
    v_format := '{"prefix":"CS","date_format":"YYMM","seq_digits":3,"reset_monthly":true,"suffix":""}'::JSONB;
  END IF;

  IF v_code_rule IS NOT NULL THEN
    v_format := v_format || v_code_rule;
  END IF;

  v_prefix        := COALESCE(NULLIF(v_format->>'prefix', ''), 'CS');
  v_date_format   := COALESCE(v_format->>'date_format', 'YYMM');
  v_seq_digits    := COALESCE((v_format->>'seq_digits')::INT, 3);
  v_reset_monthly := COALESCE((v_format->>'reset_monthly')::BOOLEAN, TRUE);
  v_suffix        := COALESCE(v_format->>'suffix', '');

  IF v_date_format = 'NONE' THEN
    v_year_month := '';
  ELSIF v_date_format = 'YYYYMM' THEN
    v_year_month := TO_CHAR(NOW(), 'YYYYMM');
  ELSE
    v_year_month := TO_CHAR(NOW(), 'YYMM');
  END IF;

  IF v_date_format <> 'NONE' AND NOT v_reset_monthly THEN
    v_year_month := 'all';
  END IF;

  INSERT INTO product_code_sequences (category_code, year_month, next_seq)
  VALUES (v_cat_code, CASE WHEN v_year_month = '' THEN 'nodate' ELSE v_year_month END, 2)
  ON CONFLICT (category_code, year_month)
  DO UPDATE SET next_seq = product_code_sequences.next_seq + 1
  RETURNING product_code_sequences.next_seq - 1 INTO v_seq;

  IF v_seq IS NULL THEN v_seq := 1; END IF;

  v_seq_padded := LPAD(v_seq::TEXT, v_seq_digits, '0');

  IF v_suffix <> '' THEN
    v_product_code := v_prefix || v_cat_code || v_year_month || v_seq_padded || v_suffix;
  ELSE
    v_product_code := v_prefix || v_cat_code || v_year_month || v_seq_padded;
  END IF;

  UPDATE products SET product_code = v_product_code WHERE id = p_product_id;
  RETURN v_product_code;
END;
$$;

REVOKE ALL ON FUNCTION generate_product_code(UUID, TEXT, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION generate_product_code(UUID, TEXT, UUID) TO service_role;
