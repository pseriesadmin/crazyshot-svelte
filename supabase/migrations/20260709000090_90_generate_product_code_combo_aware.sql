-- Migration #90: generate_product_code 콤보 인식 + 품번 보호
-- 목적:
--   1. date_option (none/ym/ymd) → 콤보 행 설정을 RPC에 직접 반영
--   2. max_sequence → 순번 상한 초과 시 예외 발생
--   3. 기존 품번 보호 → product_code가 이미 있으면 덮어쓰지 않고 반환
--
-- 변경 대상:
--   - generate_product_code(UUID, TEXT)             : 품번 보호 guard 추가
--   - generate_product_code(UUID, TEXT, UUID)        : 품번 보호 guard 추가
--   - generate_product_code(UUID, TEXT, UUID, TEXT, INT) : 신규 오버로드 (콤보 인식)

-- ─────────────────────────────────────────────────────────────────────────────
-- ① 2-param 버전: 품번 보호 guard 추가
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_existing_code    TEXT;
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
  -- Guard: 이미 품번이 있으면 반환 (수정 불가)
  SELECT product_code INTO v_existing_code FROM products WHERE id = p_product_id;
  IF v_existing_code IS NOT NULL THEN
    RETURN v_existing_code;
  END IF;

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

  SELECT cs.value INTO v_format FROM cms_settings cs WHERE cs.key = 'reservation_code_format';
  IF v_format IS NULL THEN
    v_format := '{"prefix":"CS","date_format":"YYMM","seq_digits":3,"reset_monthly":true,"suffix":""}'::JSONB;
  END IF;
  IF v_code_rule IS NOT NULL THEN v_format := v_format || v_code_rule; END IF;

  v_prefix        := COALESCE(NULLIF(v_format->>'prefix', ''), 'CS');
  v_date_format   := COALESCE(v_format->>'date_format', 'YYMM');
  v_seq_digits    := COALESCE((v_format->>'seq_digits')::INT, 3);
  v_reset_monthly := COALESCE((v_format->>'reset_monthly')::BOOLEAN, TRUE);
  v_suffix        := COALESCE(v_format->>'suffix', '');

  IF v_date_format = 'NONE' THEN v_year_month := '';
  ELSIF v_date_format = 'YYYYMM' THEN v_year_month := TO_CHAR(NOW(), 'YYYYMM');
  ELSE v_year_month := TO_CHAR(NOW(), 'YYMM'); END IF;
  IF v_date_format <> 'NONE' AND NOT v_reset_monthly THEN v_year_month := 'all'; END IF;

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


-- ─────────────────────────────────────────────────────────────────────────────
-- ② 3-param 버전: 품번 보호 guard 추가
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_existing_code    TEXT;
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
  -- Guard: 이미 품번이 있으면 반환 (수정 불가)
  SELECT product_code INTO v_existing_code FROM products WHERE id = p_product_id;
  IF v_existing_code IS NOT NULL THEN
    RETURN v_existing_code;
  END IF;

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

  SELECT cs.value INTO v_format FROM cms_settings cs WHERE cs.key = 'reservation_code_format';
  IF v_format IS NULL THEN
    v_format := '{"prefix":"CS","date_format":"YYMM","seq_digits":3,"reset_monthly":true,"suffix":""}'::JSONB;
  END IF;
  IF v_code_rule IS NOT NULL THEN v_format := v_format || v_code_rule; END IF;

  v_prefix        := COALESCE(NULLIF(v_format->>'prefix', ''), 'CS');
  v_date_format   := COALESCE(v_format->>'date_format', 'YYMM');
  v_seq_digits    := COALESCE((v_format->>'seq_digits')::INT, 3);
  v_reset_monthly := COALESCE((v_format->>'reset_monthly')::BOOLEAN, TRUE);
  v_suffix        := COALESCE(v_format->>'suffix', '');

  IF v_date_format = 'NONE' THEN v_year_month := '';
  ELSIF v_date_format = 'YYYYMM' THEN v_year_month := TO_CHAR(NOW(), 'YYYYMM');
  ELSE v_year_month := TO_CHAR(NOW(), 'YYMM'); END IF;
  IF v_date_format <> 'NONE' AND NOT v_reset_monthly THEN v_year_month := 'all'; END IF;

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


-- ─────────────────────────────────────────────────────────────────────────────
-- ③ 신규 5-param 오버로드: 콤보 date_option + max_sequence 직접 반영
--    호출: generate_product_code(id, cat, code_id, date_option, max_seq)
--    date_option: 'none'|'ym'|'ymd'
--    max_sequence: 순번 상한 (초과 시 예외)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION generate_product_code(
  p_product_id   UUID,
  p_category     TEXT,
  p_code_id      UUID,
  p_date_option  TEXT,   -- 콤보 행의 date_option: 'none' | 'ym' | 'ymd'
  p_max_sequence INT     -- 콤보 행의 max_sequence (순번 상한)
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_code TEXT;
  v_cat_code      TEXT;
  v_code_rule     JSONB;
  v_format        JSONB;
  v_prefix        TEXT;
  v_seq_digits    INT;
  v_suffix        TEXT;
  v_year_month    TEXT;
  v_seq_key       TEXT;
  v_seq           INT;
  v_seq_padded    TEXT;
  v_product_code  TEXT;
BEGIN
  -- Guard: 이미 품번이 있으면 반환 (한번 매핑된 품번은 수정 불가)
  SELECT product_code INTO v_existing_code FROM products WHERE id = p_product_id;
  IF v_existing_code IS NOT NULL THEN
    RETURN v_existing_code;
  END IF;

  -- 분류코드 조회 (p_code_id 지정 시 직접 사용)
  IF p_code_id IS NOT NULL THEN
    SELECT pcc.code, pcc.code_rule INTO v_cat_code, v_code_rule
    FROM   product_category_codes pcc
    WHERE  pcc.id = p_code_id AND pcc.is_active = TRUE AND pcc.deleted_at IS NULL;
  END IF;

  -- Fallback: p_code_id 미지정 또는 조회 실패
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

  -- 전역 포맷 읽기 (prefix, seq_digits, suffix 추출용)
  SELECT cs.value INTO v_format FROM cms_settings cs WHERE cs.key = 'reservation_code_format';
  IF v_format IS NULL THEN
    v_format := '{"prefix":"CS","date_format":"YYMM","seq_digits":3,"reset_monthly":true,"suffix":""}'::JSONB;
  END IF;
  IF v_code_rule IS NOT NULL THEN v_format := v_format || v_code_rule; END IF;

  v_prefix     := COALESCE(NULLIF(v_format->>'prefix', ''), 'CS');
  v_seq_digits := COALESCE((v_format->>'seq_digits')::INT, 3);
  v_suffix     := COALESCE(v_format->>'suffix', '');

  -- date_option → 년월 파트 결정 (콤보 설정 우선, 전역 설정 무시)
  CASE p_date_option
    WHEN 'none' THEN v_year_month := '';
    WHEN 'ymd'  THEN v_year_month := TO_CHAR(NOW(), 'YYMMDD');
    ELSE             v_year_month := TO_CHAR(NOW(), 'YYMM');   -- 'ym' (기본)
  END CASE;

  -- 시퀀스 키 (날짜 없으면 'nodate' 고정)
  v_seq_key := CASE WHEN v_year_month = '' THEN 'nodate' ELSE v_year_month END;

  -- 순번 채번
  INSERT INTO product_code_sequences (category_code, year_month, next_seq)
  VALUES (v_cat_code, v_seq_key, 2)
  ON CONFLICT (category_code, year_month)
  DO UPDATE SET next_seq = product_code_sequences.next_seq + 1
  RETURNING product_code_sequences.next_seq - 1 INTO v_seq;
  IF v_seq IS NULL THEN v_seq := 1; END IF;

  -- 순번 상한 체크
  IF v_seq > p_max_sequence THEN
    RAISE EXCEPTION 'max_sequence_exceeded: 이 조합코드(%)의 순번 상한(%)에 도달했습니다. 관리자에게 문의하거나 max_sequence를 늘려주세요.',
      v_cat_code, p_max_sequence
      USING ERRCODE = 'P0001';
  END IF;

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

REVOKE ALL ON FUNCTION generate_product_code(UUID, TEXT, UUID, TEXT, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION generate_product_code(UUID, TEXT, UUID, TEXT, INT) TO service_role;
