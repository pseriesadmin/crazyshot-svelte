-- Migration #81: 상품 분류코드 생성 구조 재구성
-- 변경 내용:
--   1. product_category_codes.meta_keywords TEXT[] 추가
--   2. product_category_codes.code 허용 문자 CHECK 추가 (#, %, &, @ 허용)
--   3. cms_add_taxonomy_code RPC: meta_keywords 파라미터 추가
--   4. cms_edit_taxonomy_code RPC: meta_keywords 파라미터 추가
--   5. generate_product_code (2-param, 3-param): included_levels 지원
--      code_rule.included_levels: ["L0","L1","L2","seq"] 형태
--      L0 = 대분류 코드 세그먼트, L1 = 중분류, L2 = 소분류, seq = 순번 (항상 포함)

-- ── 1. meta_keywords 컬럼 추가 ───────────────────────────────────────────
ALTER TABLE product_category_codes
  ADD COLUMN IF NOT EXISTS meta_keywords TEXT[] DEFAULT '{}';

-- ── 2. code 컬럼 CHECK 제약 추가 (영문·숫자·#%&@ 허용, 하이픈 금지) ────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_category_codes_code_chars_check'
      AND conrelid = 'product_category_codes'::regclass
  ) THEN
    ALTER TABLE product_category_codes
      ADD CONSTRAINT product_category_codes_code_chars_check
      CHECK (code ~ '^[A-Za-z0-9#%&@]{1,20}$');
  END IF;
END $$;

-- ── 3. cms_add_taxonomy_code RPC 업데이트 (meta_keywords 추가) ─────────────
CREATE OR REPLACE FUNCTION cms_add_taxonomy_code(
  p_code             TEXT,
  p_name             TEXT,
  p_parent_id        UUID    DEFAULT NULL,
  p_depth            INT     DEFAULT 0,
  p_path_codes       TEXT[]  DEFAULT '{}',
  p_product_category TEXT    DEFAULT NULL,
  p_description      TEXT    DEFAULT NULL,
  p_sort_order       INT     DEFAULT 99,
  p_meta_keywords    TEXT[]  DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO product_category_codes (
    code, name, parent_id, depth, path_codes,
    product_category, description, sort_order, is_active,
    meta_keywords, created_at
  )
  VALUES (
    p_code, p_name, p_parent_id, p_depth, p_path_codes,
    NULLIF(p_product_category, ''),
    NULLIF(p_description, ''),
    p_sort_order, TRUE,
    COALESCE(p_meta_keywords, '{}'),
    NOW()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION cms_add_taxonomy_code(TEXT,TEXT,UUID,INT,TEXT[],TEXT,TEXT,INT,TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cms_add_taxonomy_code(TEXT,TEXT,UUID,INT,TEXT[],TEXT,TEXT,INT,TEXT[]) TO service_role;

-- ── 4. cms_edit_taxonomy_code RPC 업데이트 (meta_keywords 추가) ────────────
CREATE OR REPLACE FUNCTION cms_edit_taxonomy_code(
  p_id               UUID,
  p_name             TEXT,
  p_description      TEXT    DEFAULT NULL,
  p_product_category TEXT    DEFAULT NULL,
  p_sort_order       INT     DEFAULT 99,
  p_meta_keywords    TEXT[]  DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE product_category_codes
  SET
    name             = p_name,
    description      = NULLIF(p_description, ''),
    product_category = NULLIF(p_product_category, ''),
    sort_order       = p_sort_order,
    meta_keywords    = CASE WHEN p_meta_keywords IS NOT NULL THEN p_meta_keywords ELSE meta_keywords END
  WHERE id = p_id
    AND deleted_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION cms_edit_taxonomy_code(UUID,TEXT,TEXT,TEXT,INT,TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cms_edit_taxonomy_code(UUID,TEXT,TEXT,TEXT,INT,TEXT[]) TO service_role;

-- ── 5. generate_product_code (2-param) 업데이트: included_levels 지원 ──────
--
-- code_rule.included_levels 배열로 코드 세그먼트 조합 방식 제어:
--   "L0" → 대분류 세그먼트 (path_codes[1])
--   "L1" → 중분류 세그먼트 (path_codes[2]에서 path_codes[1] 접두어를 제거)
--   "L2" → 소분류 세그먼트 (path_codes[3]에서 path_codes[2] 접두어를 제거)
--   "seq" → 순번 (명시하지 않아도 항상 포함)
--
-- included_levels가 없으면 기존 동작(v_cat_code 그대로 사용) 유지 — 하위호환 보장
--
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
  v_root_code_rule   JSONB;
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
  v_path_codes       TEXT[];
  v_included_levels  TEXT[];
  v_composed         TEXT;
  v_parent_code      TEXT;
  v_local_seg        TEXT;
BEGIN
  -- Step 1: category_taxonomy_map 경유 분류 코드 조회
  SELECT ctm.taxonomy_code_id
  INTO   v_taxonomy_code_id
  FROM   category_taxonomy_map ctm
  WHERE  ctm.product_category = p_category
  ORDER  BY ctm.priority DESC
  LIMIT  1;

  IF v_taxonomy_code_id IS NOT NULL THEN
    SELECT pcc.code, pcc.code_rule, pcc.path_codes
    INTO   v_cat_code, v_code_rule, v_path_codes
    FROM   product_category_codes pcc
    WHERE  pcc.id         = v_taxonomy_code_id
      AND  pcc.is_active  = TRUE
      AND  pcc.deleted_at IS NULL;
  END IF;

  -- Fallback 1: product_category_codes.product_category 직접 조회
  IF v_cat_code IS NULL THEN
    SELECT pcc.code, pcc.code_rule, pcc.path_codes
    INTO   v_cat_code, v_code_rule, v_path_codes
    FROM   product_category_codes pcc
    WHERE  pcc.product_category = p_category
      AND  pcc.depth            = 0
      AND  pcc.is_active        = TRUE
      AND  pcc.deleted_at       IS NULL
    LIMIT  1;
  END IF;

  -- Fallback 2: 카테고리명 앞 3자리 대문자
  IF v_cat_code IS NULL THEN
    v_cat_code   := UPPER(LEFT(p_category, 3));
    v_path_codes := ARRAY[v_cat_code];
  END IF;

  -- Step 1b: 루트 노드의 code_rule에서 included_levels 읽기
  -- (resolved node가 depth>0인 경우 루트를 따로 조회)
  IF v_path_codes IS NOT NULL AND array_length(v_path_codes, 1) > 0 THEN
    IF v_code_rule IS NULL OR NOT (v_code_rule ? 'included_levels') THEN
      SELECT pcc.code_rule
      INTO   v_root_code_rule
      FROM   product_category_codes pcc
      WHERE  pcc.code        = v_path_codes[1]
        AND  pcc.depth       = 0
        AND  pcc.deleted_at  IS NULL
      LIMIT  1;
      IF v_root_code_rule IS NOT NULL THEN
        v_code_rule := v_code_rule || v_root_code_rule;
      END IF;
    END IF;
  END IF;

  -- Step 1c: included_levels로 복합 cat_code 생성
  IF v_code_rule IS NOT NULL AND v_code_rule ? 'included_levels' THEN
    v_included_levels := ARRAY(SELECT jsonb_array_elements_text(v_code_rule->'included_levels'));
    v_composed := '';

    -- L0 세그먼트 (대분류 코드 전체)
    IF 'L0' = ANY(v_included_levels) AND array_length(v_path_codes, 1) >= 1 THEN
      v_composed := v_composed || v_path_codes[1];
    END IF;

    -- L1 세그먼트 (중분류 로컬 접미어: path[2] - path[1] 접두어 제거)
    IF 'L1' = ANY(v_included_levels) AND array_length(v_path_codes, 1) >= 2 THEN
      v_parent_code := v_path_codes[1];
      IF v_path_codes[2] LIKE (v_parent_code || '%') THEN
        v_local_seg := SUBSTRING(v_path_codes[2] FROM LENGTH(v_parent_code) + 1);
      ELSE
        v_local_seg := v_path_codes[2];
      END IF;
      v_composed := v_composed || v_local_seg;
    END IF;

    -- L2 세그먼트 (소분류 로컬 접미어: path[3] - path[2] 접두어 제거)
    IF 'L2' = ANY(v_included_levels) AND array_length(v_path_codes, 1) >= 3 THEN
      v_parent_code := v_path_codes[2];
      IF v_path_codes[3] LIKE (v_parent_code || '%') THEN
        v_local_seg := SUBSTRING(v_path_codes[3] FROM LENGTH(v_parent_code) + 1);
      ELSE
        v_local_seg := v_path_codes[3];
      END IF;
      v_composed := v_composed || v_local_seg;
    END IF;

    IF v_composed <> '' THEN
      v_cat_code := v_composed;
    END IF;
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

  v_prefix        := COALESCE(NULLIF(v_format->>'prefix', ''), 'CS');
  v_date_format   := COALESCE(v_format->>'date_format', 'YYMM');
  v_seq_digits    := COALESCE((v_format->>'seq_digits')::INT, 3);
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


-- ── 6. generate_product_code (3-param) 업데이트: included_levels 지원 ──────
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
  v_root_code_rule   JSONB;
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
  v_path_codes       TEXT[];
  v_included_levels  TEXT[];
  v_composed         TEXT;
  v_parent_code      TEXT;
  v_local_seg        TEXT;
BEGIN
  -- Step 1: p_code_id 직접 지정 시 taxonomy_map 스킵
  IF p_code_id IS NOT NULL THEN
    SELECT pcc.code, pcc.code_rule, pcc.path_codes
    INTO   v_cat_code, v_code_rule, v_path_codes
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
      SELECT pcc.code, pcc.code_rule, pcc.path_codes
      INTO   v_cat_code, v_code_rule, v_path_codes
      FROM   product_category_codes pcc
      WHERE  pcc.id         = v_taxonomy_code_id
        AND  pcc.is_active  = TRUE
        AND  pcc.deleted_at IS NULL;
    END IF;

    IF v_cat_code IS NULL THEN
      SELECT pcc.code, pcc.code_rule, pcc.path_codes
      INTO   v_cat_code, v_code_rule, v_path_codes
      FROM   product_category_codes pcc
      WHERE  pcc.product_category = p_category
        AND  pcc.depth            = 0
        AND  pcc.is_active        = TRUE
        AND  pcc.deleted_at       IS NULL
      LIMIT  1;
    END IF;

    IF v_cat_code IS NULL THEN
      v_cat_code   := UPPER(LEFT(p_category, 3));
      v_path_codes := ARRAY[v_cat_code];
    END IF;
  END IF;

  -- Step 1b: 루트 code_rule에서 included_levels 읽기
  IF v_path_codes IS NOT NULL AND array_length(v_path_codes, 1) > 0 THEN
    IF v_code_rule IS NULL OR NOT (v_code_rule ? 'included_levels') THEN
      SELECT pcc.code_rule
      INTO   v_root_code_rule
      FROM   product_category_codes pcc
      WHERE  pcc.code       = v_path_codes[1]
        AND  pcc.depth      = 0
        AND  pcc.deleted_at IS NULL
      LIMIT  1;
      IF v_root_code_rule IS NOT NULL THEN
        v_code_rule := COALESCE(v_code_rule, '{}'::JSONB) || v_root_code_rule;
      END IF;
    END IF;
  END IF;

  -- Step 1c: included_levels로 복합 cat_code 생성
  IF v_code_rule IS NOT NULL AND v_code_rule ? 'included_levels' THEN
    v_included_levels := ARRAY(SELECT jsonb_array_elements_text(v_code_rule->'included_levels'));
    v_composed := '';

    IF 'L0' = ANY(v_included_levels) AND array_length(v_path_codes, 1) >= 1 THEN
      v_composed := v_composed || v_path_codes[1];
    END IF;

    IF 'L1' = ANY(v_included_levels) AND array_length(v_path_codes, 1) >= 2 THEN
      v_parent_code := v_path_codes[1];
      IF v_path_codes[2] LIKE (v_parent_code || '%') THEN
        v_local_seg := SUBSTRING(v_path_codes[2] FROM LENGTH(v_parent_code) + 1);
      ELSE
        v_local_seg := v_path_codes[2];
      END IF;
      v_composed := v_composed || v_local_seg;
    END IF;

    IF 'L2' = ANY(v_included_levels) AND array_length(v_path_codes, 1) >= 3 THEN
      v_parent_code := v_path_codes[2];
      IF v_path_codes[3] LIKE (v_parent_code || '%') THEN
        v_local_seg := SUBSTRING(v_path_codes[3] FROM LENGTH(v_parent_code) + 1);
      ELSE
        v_local_seg := v_path_codes[3];
      END IF;
      v_composed := v_composed || v_local_seg;
    END IF;

    IF v_composed <> '' THEN
      v_cat_code := v_composed;
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

  v_prefix        := COALESCE(NULLIF(v_format->>'prefix', ''), 'CS');
  v_date_format   := COALESCE(v_format->>'date_format', 'YYMM');
  v_seq_digits    := COALESCE((v_format->>'seq_digits')::INT, 3);
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
