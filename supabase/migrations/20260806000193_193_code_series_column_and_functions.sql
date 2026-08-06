-- Migration #193: 품번 체계 재설계 — 부모=구조저장(code_series), 자식=실채번
-- 정책: 부모 상품은 product_code를 받지 않는다.
--       부모 등록 시 채번 구조(카테고리코드/연월/prefix/suffix/자릿수)를 code_series JSONB에 저장.
--       실제 product_code는 자식(재고 단위) 생성 시에만 code_series를 읽어 순번 소모 후 완성.
--
-- CODE-SERIES-1: products.code_series JSONB nullable 컬럼 추가
-- CODE-SERIES-2: generate_product_code (2/3/5-param) — 구조결정(①~③)만, 순번 미소모
-- CODE-SERIES-3: generate_inventory_product_code — code_series 기반 순번 소모 + 실채번
-- CODE-SERIES-4: auto_create_inventory_for_product — 게이트 변경 (product_code → code_series)

-- ─────────────────────────────────────────────────────────────────────────────
-- CODE-SERIES-1: code_series 컬럼 추가
-- 기존 행(자식·레거시 부모 포함)은 전부 null → 소급 정리 없음 (Stephen 확정)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS code_series JSONB;

COMMENT ON COLUMN public.products.code_series IS
  '부모 상품 전용 품번 채번 구조. 예) {"category_code":"LENCOM","year_month":"2608","prefix":"CS","suffix":"","seq_digits":3,"max_sequence":null}.
   year_month 값: "nodate"(날짜 없음), "all"(월별 미초기화), 또는 실제 연월(예 "2608"/"202608"/"260801").
   자식·레거시 부모는 NULL. 자식의 실제 product_code는 generate_inventory_product_code가 채번.';


-- ─────────────────────────────────────────────────────────────────────────────
-- CODE-SERIES-2-①: generate_product_code (2-param) 재작성
-- 변경: 순번 미소모, product_code 미기록 → code_series JSONB 저장
-- 변경: Guard를 product_code IS NOT NULL → code_series IS NOT NULL
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_product_code(
  p_product_id UUID,
  p_category   TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_series  JSONB;
  v_taxonomy_code_id UUID;
  v_cat_code         TEXT;
  v_code_rule        JSONB;
  v_format           JSONB;
  v_prefix           TEXT;
  v_date_format      TEXT;
  v_seq_digits       INT;
  v_reset_monthly    BOOLEAN;
  v_suffix           TEXT;
  v_year_month       TEXT;  -- 시퀀스 키: 'nodate' / 'all' / 실제 연월값
BEGIN
  -- Guard: 이미 code_series가 있으면 재설정 안 함 (구조는 한번 정해지면 고정)
  SELECT code_series INTO v_existing_series
  FROM products WHERE id = p_product_id;
  IF v_existing_series IS NOT NULL THEN
    RETURN NULL;
  END IF;

  -- ① 카테고리코드 결정 (taxonomy_map 우선 → depth=0 fallback → 상위3글자 fallback)
  SELECT ctm.taxonomy_code_id INTO v_taxonomy_code_id
  FROM   category_taxonomy_map ctm
  WHERE  ctm.product_category = p_category
  ORDER  BY ctm.priority DESC
  LIMIT  1;

  IF v_taxonomy_code_id IS NOT NULL THEN
    SELECT pcc.code, pcc.code_rule INTO v_cat_code, v_code_rule
    FROM   product_category_codes pcc
    WHERE  pcc.id = v_taxonomy_code_id
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

  -- ② 포맷 결정 (전역 cms_settings + code_rule 오버라이드)
  SELECT cs.value INTO v_format
  FROM cms_settings cs WHERE cs.key = 'reservation_code_format';
  IF v_format IS NULL THEN
    v_format := '{"prefix":"CS","date_format":"YYMM","seq_digits":3,"reset_monthly":true,"suffix":""}'::JSONB;
  END IF;
  IF v_code_rule IS NOT NULL THEN v_format := v_format || v_code_rule; END IF;

  v_prefix        := COALESCE(NULLIF(v_format->>'prefix', ''), 'CS');
  v_date_format   := COALESCE(v_format->>'date_format', 'YYMM');
  v_seq_digits    := COALESCE((v_format->>'seq_digits')::INT, 3);
  v_reset_monthly := COALESCE((v_format->>'reset_monthly')::BOOLEAN, TRUE);
  v_suffix        := COALESCE(v_format->>'suffix', '');

  -- ③ 시퀀스 키(year_month) 결정 — 순번은 소모하지 않음
  --    'nodate': 날짜 없음, 'all': 월별 미초기화, 실제연월: 날짜 있음
  IF v_date_format = 'NONE' THEN
    v_year_month := 'nodate';
  ELSIF v_date_format = 'YYYYMM' THEN
    v_year_month := TO_CHAR(NOW(), 'YYYYMM');
  ELSE
    v_year_month := TO_CHAR(NOW(), 'YYMM');
  END IF;
  IF v_date_format <> 'NONE' AND NOT v_reset_monthly THEN
    v_year_month := 'all';
  END IF;

  -- code_series JSONB 저장 (순번 미소모, product_code 미기록)
  UPDATE products
  SET code_series = jsonb_build_object(
    'category_code', v_cat_code,
    'year_month',    v_year_month,
    'prefix',        v_prefix,
    'suffix',        v_suffix,
    'seq_digits',    v_seq_digits,
    'max_sequence',  NULL
  )
  WHERE id = p_product_id;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_product_code(UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.generate_product_code(UUID, TEXT) TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- CODE-SERIES-2-②: generate_product_code (3-param) 재작성
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_product_code(
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
  v_existing_series  JSONB;
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
BEGIN
  -- Guard: 이미 code_series가 있으면 재설정 안 함
  SELECT code_series INTO v_existing_series
  FROM products WHERE id = p_product_id;
  IF v_existing_series IS NOT NULL THEN
    RETURN NULL;
  END IF;

  -- ① 카테고리코드 결정 (p_code_id 지정 시 직접 사용)
  IF p_code_id IS NOT NULL THEN
    SELECT pcc.code, pcc.code_rule INTO v_cat_code, v_code_rule
    FROM   product_category_codes pcc
    WHERE  pcc.id = p_code_id
      AND  pcc.is_active = TRUE AND pcc.deleted_at IS NULL;
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
      WHERE  pcc.id = v_taxonomy_code_id
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

  -- ② 포맷 결정
  SELECT cs.value INTO v_format
  FROM cms_settings cs WHERE cs.key = 'reservation_code_format';
  IF v_format IS NULL THEN
    v_format := '{"prefix":"CS","date_format":"YYMM","seq_digits":3,"reset_monthly":true,"suffix":""}'::JSONB;
  END IF;
  IF v_code_rule IS NOT NULL THEN v_format := v_format || v_code_rule; END IF;

  v_prefix        := COALESCE(NULLIF(v_format->>'prefix', ''), 'CS');
  v_date_format   := COALESCE(v_format->>'date_format', 'YYMM');
  v_seq_digits    := COALESCE((v_format->>'seq_digits')::INT, 3);
  v_reset_monthly := COALESCE((v_format->>'reset_monthly')::BOOLEAN, TRUE);
  v_suffix        := COALESCE(v_format->>'suffix', '');

  -- ③ 시퀀스 키 결정
  IF v_date_format = 'NONE' THEN
    v_year_month := 'nodate';
  ELSIF v_date_format = 'YYYYMM' THEN
    v_year_month := TO_CHAR(NOW(), 'YYYYMM');
  ELSE
    v_year_month := TO_CHAR(NOW(), 'YYMM');
  END IF;
  IF v_date_format <> 'NONE' AND NOT v_reset_monthly THEN
    v_year_month := 'all';
  END IF;

  -- code_series 저장
  UPDATE products
  SET code_series = jsonb_build_object(
    'category_code', v_cat_code,
    'year_month',    v_year_month,
    'prefix',        v_prefix,
    'suffix',        v_suffix,
    'seq_digits',    v_seq_digits,
    'max_sequence',  NULL
  )
  WHERE id = p_product_id;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_product_code(UUID, TEXT, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.generate_product_code(UUID, TEXT, UUID) TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- CODE-SERIES-2-③: generate_product_code (5-param) 재작성
-- p_date_option: 'none'|'ym'|'ymd', p_max_sequence: 순번 상한 (code_series에 보관)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_product_code(
  p_product_id   UUID,
  p_category     TEXT,
  p_code_id      UUID,
  p_date_option  TEXT,   -- 콤보 행의 date_option: 'none' | 'ym' | 'ymd'
  p_max_sequence INT     -- 콤보 행의 순번 상한 (자식 채번 시 초과 체크)
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_series JSONB;
  v_cat_code        TEXT;
  v_code_rule       JSONB;
  v_format          JSONB;
  v_prefix          TEXT;
  v_seq_digits      INT;
  v_suffix          TEXT;
  v_year_month      TEXT;
BEGIN
  -- Guard: 이미 code_series가 있으면 재설정 안 함
  SELECT code_series INTO v_existing_series
  FROM products WHERE id = p_product_id;
  IF v_existing_series IS NOT NULL THEN
    RETURN NULL;
  END IF;

  -- ① 카테고리코드 결정 (p_code_id 지정 시 직접 사용)
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

  -- ③ date_option → 시퀀스 키 결정 (콤보 설정 우선)
  CASE p_date_option
    WHEN 'none' THEN v_year_month := 'nodate';
    WHEN 'ymd'  THEN v_year_month := TO_CHAR(NOW(), 'YYMMDD');
    ELSE             v_year_month := TO_CHAR(NOW(), 'YYMM');  -- 'ym' 기본
  END CASE;

  -- code_series 저장 (max_sequence 포함 — 자식 채번 시 초과 체크에 사용)
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

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_product_code(UUID, TEXT, UUID, TEXT, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.generate_product_code(UUID, TEXT, UUID, TEXT, INT) TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- CODE-SERIES-3: generate_inventory_product_code 재작성
-- 변경: 부모 product_code 문자열 파싱 → 부모 code_series JSONB 읽기
-- code_series.year_month: 'nodate'→date_part='', 그 외→date_part=year_month 값
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_cat_code      TEXT;
  v_year_month    TEXT;   -- code_series에 저장된 시퀀스 키
  v_prefix        TEXT;
  v_suffix        TEXT;
  v_seq_digits    INT;
  v_max_sequence  INT;
  v_date_part     TEXT;   -- 실제 품번 문자열에 들어가는 날짜 파트
  v_seq           INT;
  v_seq_padded    TEXT;
  v_child_code    TEXT;
BEGIN
  -- Guard: 자식 자신의 product_code가 이미 있으면 그대로 반환
  SELECT product_code INTO v_child_code
  FROM products WHERE id = p_product_id;
  IF v_child_code IS NOT NULL THEN RETURN v_child_code; END IF;

  -- 부모의 code_series JSONB 읽기
  SELECT code_series INTO v_parent_series
  FROM products
  WHERE id = p_parent_product_id AND deleted_at IS NULL;

  IF v_parent_series IS NULL THEN
    RAISE EXCEPTION '부모 상품의 품번 체계가 설정되지 않았습니다. (parent_product_id: %)', p_parent_product_id;
  END IF;

  -- code_series에서 채번 정보 추출
  v_cat_code     := v_parent_series->>'category_code';
  v_year_month   := v_parent_series->>'year_month';  -- 'nodate' / 'all' / 실제연월
  v_prefix       := COALESCE(NULLIF(v_parent_series->>'prefix', ''), 'CS');
  v_suffix       := COALESCE(v_parent_series->>'suffix', '');
  v_seq_digits   := COALESCE((v_parent_series->>'seq_digits')::INT, 3);
  v_max_sequence := (v_parent_series->>'max_sequence')::INT;  -- max_sequence가 없으면 NULL

  -- 시퀀스 키는 code_series.year_month 그대로 사용
  -- 날짜 파트: 'nodate'는 품번 문자열에서 빈 문자열, 그 외는 year_month 값 그대로 삽입
  v_date_part := CASE WHEN v_year_month = 'nodate' OR v_year_month IS NULL
                      THEN ''
                      ELSE v_year_month
                 END;

  -- ④ 원자적 순번 증가 (INSERT ON CONFLICT — 시퀀스 행이 없으면 신규 생성)
  INSERT INTO product_code_sequences (category_code, year_month, next_seq)
  VALUES (v_cat_code, COALESCE(v_year_month, 'nodate'), 2)
  ON CONFLICT (category_code, year_month)
  DO UPDATE SET next_seq = product_code_sequences.next_seq + 1
  RETURNING product_code_sequences.next_seq - 1 INTO v_seq;
  IF v_seq IS NULL THEN v_seq := 1; END IF;

  -- max_sequence 초과 체크 (code_series에 설정된 경우에만)
  IF v_max_sequence IS NOT NULL AND v_seq > v_max_sequence THEN
    RAISE EXCEPTION 'max_sequence_exceeded: 이 품번 체계(%)의 순번 상한(%)에 도달했습니다. 관리자에게 문의하거나 max_sequence를 늘려주세요.',
      v_cat_code, v_max_sequence
      USING ERRCODE = 'P0001';
  END IF;

  -- ⑤ 품번 문자열 조합: prefix + category_code + date_part + seq_padded [+ suffix]
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
  '빠른 재고 등록 전용: 부모의 code_series(품번 채번 구조 JSON)를 읽어 동일 체계로 자식 품번 채번.
   예) 부모 code_series {category_code:"LENCOM", year_month:"2608", prefix:"CS", ...}
   → 자식 CSLENCOM2608001, CSLENCOM2608002, ...
   code_series가 없는 레거시 부모(null)에 호출하면 명확한 예외를 발생시킨다.';

REVOKE ALL ON FUNCTION public.generate_inventory_product_code(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.generate_inventory_product_code(UUID, UUID) TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- CODE-SERIES-4: auto_create_inventory_for_product 재정의
-- 변경: 자식 코드 생성 게이트 — product_code IS NOT NULL → code_series IS NOT NULL
-- 나머지 로직(자식 행 생성, qr_payload 설정, price_rules 복사)은 migration 168과 동일
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_create_inventory_for_product(
  p_product_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent   RECORD;
  v_child_id UUID;
BEGIN
  SELECT id, name, slug, category, brand, description,
         image_urls, specifications, components, keywords,
         content_blocks, sale_price, sale_only, code_series
  INTO v_parent
  FROM products
  WHERE id = p_product_id
    AND deleted_at IS NULL
    AND parent_product_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product not found or is already a child: %', p_product_id;
  END IF;

  INSERT INTO products (
    parent_product_id,
    name, slug, category, brand, description,
    image_urls, specifications, components, keywords,
    content_blocks, is_active, sale_price, sale_only,
    qr_payload
  ) VALUES (
    p_product_id,
    v_parent.name,
    v_parent.slug || '-inv-' || gen_random_uuid()::text,
    v_parent.category,
    v_parent.brand,
    v_parent.description,
    v_parent.image_urls,
    v_parent.specifications,
    v_parent.components,
    v_parent.keywords,
    v_parent.content_blocks,
    true,
    v_parent.sale_price,
    v_parent.sale_only,
    NULL  -- 생성 직후 아래에서 고유 URL로 갱신 (id 확정 후)
  )
  RETURNING id INTO v_child_id;

  -- id 확정 후 전용 QR URL 설정
  UPDATE products
  SET qr_payload = 'https://crazyshot.kr/qr/product/' || v_child_id
  WHERE id = v_child_id;

  -- ★ CODE-SERIES-4 변경: product_code IS NOT NULL → code_series IS NOT NULL
  --   부모에 채번 구조(code_series)가 설정돼 있을 때만 자식 품번 자동 채번
  IF v_parent.code_series IS NOT NULL THEN
    BEGIN
      PERFORM generate_inventory_product_code(v_child_id, p_product_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'inventory code generation skipped for %: %', v_child_id, SQLERRM;
    END;
  END IF;

  INSERT INTO price_rules (
    product_id, duration_type, price,
    deposit_amount, late_fee_per_hour, damage_fee_percentage
  )
  SELECT
    v_child_id, duration_type, price,
    deposit_amount, late_fee_per_hour, damage_fee_percentage
  FROM price_rules
  WHERE product_id = p_product_id;

  RETURN v_child_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_create_inventory_for_product(UUID) TO service_role;
