-- Migration #248: 상품 품번 채번 기본값을 예약코드 설정 키에서 분리
--
-- 문제: generate_product_code() 전체 오버로드(5개)가 예약코드 전용 설정인
--       cms_settings.reservation_code_format을 그대로 읽어 상품 품번 채번의
--       전역 기본값(prefix/date_format/seq_digits/reset_monthly/suffix)으로도
--       사용하고 있었음. CMS "예약코드 형식" 탭(코드상 유일한 UI)에서 값을 바꾸면
--       카테고리별 code_rule이 없는 신규 상품의 채번 기본값도 화면 안내 없이
--       같이 바뀌는 숨은 결합 상태 — 코드에도 "M3 예약코드 구현 시 분리 예정" TODO가
--       남아있던 기술부채였음.
-- 해결: 상품 품번 전용 cms_settings 키 product_code_format 신설, 현재 공유되던
--       값을 그대로 시딩(동작 변화 없음) 후 generate_product_code() 전 오버로드와
--       클라이언트 미리보기(products/new)가 새 키를 읽도록 전환.
-- 범위: 백엔드 분리만 — "상품 품번 기본값" 별도 관리 화면은 미포함(추후 필요 시 신설).
--       지금은 이 값을 UI로 바꿀 방법이 없어졌으므로 분리 시점 값으로 고정된다.

-- ─────────────────────────────────────────────
-- 1. product_code_format 설정 키 신설 — 현재 reservation_code_format 값 복사
--    (cat_code·preview 등 예약/UI 전용 필드는 제외하고 상품 채번에 실제 쓰이는
--    필드만 시딩)
-- ─────────────────────────────────────────────
INSERT INTO cms_settings (key, value, updated_at)
SELECT
  'product_code_format',
  jsonb_build_object(
    'prefix',        COALESCE(value->>'prefix', 'CS'),
    'date_format',   COALESCE(value->>'date_format', 'YYMM'),
    'seq_digits',    COALESCE((value->>'seq_digits')::INT, 3),
    'reset_monthly', COALESCE((value->>'reset_monthly')::BOOLEAN, TRUE),
    'suffix',        COALESCE(value->>'suffix', '')
  ),
  NOW()
FROM cms_settings
WHERE key = 'reservation_code_format'
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

-- reservation_code_format 행이 아예 없던 환경 대비 기본값 폴백
INSERT INTO cms_settings (key, value, updated_at)
VALUES (
  'product_code_format',
  '{"prefix":"CS","date_format":"YYMM","seq_digits":3,"reset_monthly":true,"suffix":""}'::JSONB,
  NOW()
)
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────
-- 2. generate_product_code() 전 오버로드(5개) — 설정 키만 product_code_format으로 교체
--    (그 외 로직은 기존 라이브 함수 본문과 완전히 동일 — 문자열 치환 외 변경 없음)
-- ─────────────────────────────────────────────

-- 2-1. (p_product_id, p_category, p_code_id DEFAULT NULL) — 3-param
CREATE OR REPLACE FUNCTION public.generate_product_code(p_product_id uuid, p_category text, p_code_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  SELECT code_series INTO v_existing_series
  FROM products WHERE id = p_product_id;
  IF v_existing_series IS NOT NULL THEN
    RETURN NULL;
  END IF;

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

  SELECT cs.value INTO v_format
  FROM cms_settings cs WHERE cs.key = 'product_code_format';
  IF v_format IS NULL THEN
    v_format := '{"prefix":"CS","date_format":"YYMM","seq_digits":3,"reset_monthly":true,"suffix":""}'::JSONB;
  END IF;
  IF v_code_rule IS NOT NULL THEN v_format := v_format || v_code_rule; END IF;

  v_prefix        := COALESCE(NULLIF(v_format->>'prefix', ''), 'CS');
  v_date_format   := COALESCE(v_format->>'date_format', 'YYMM');
  v_seq_digits    := COALESCE((v_format->>'seq_digits')::INT, 3);
  v_reset_monthly := COALESCE((v_format->>'reset_monthly')::BOOLEAN, TRUE);
  v_suffix        := COALESCE(v_format->>'suffix', '');

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
$function$;

-- 2-2. (p_product_id, p_category) — 레거시 2-param (미사용 권장이나 실존 오버로드 — 정합성 위해 함께 교체)
CREATE OR REPLACE FUNCTION public.generate_product_code(p_product_id uuid, p_category text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  SELECT code_series INTO v_existing_series
  FROM products WHERE id = p_product_id;
  IF v_existing_series IS NOT NULL THEN
    RETURN NULL;
  END IF;

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

  SELECT cs.value INTO v_format
  FROM cms_settings cs WHERE cs.key = 'product_code_format';
  IF v_format IS NULL THEN
    v_format := '{"prefix":"CS","date_format":"YYMM","seq_digits":3,"reset_monthly":true,"suffix":""}'::JSONB;
  END IF;
  IF v_code_rule IS NOT NULL THEN v_format := v_format || v_code_rule; END IF;

  v_prefix        := COALESCE(NULLIF(v_format->>'prefix', ''), 'CS');
  v_date_format   := COALESCE(v_format->>'date_format', 'YYMM');
  v_seq_digits    := COALESCE((v_format->>'seq_digits')::INT, 3);
  v_reset_monthly := COALESCE((v_format->>'reset_monthly')::BOOLEAN, TRUE);
  v_suffix        := COALESCE(v_format->>'suffix', '');

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
$function$;

-- 2-3. (p_product_id, p_category, p_code_id, p_date_option, p_max_sequence) — 5-param
CREATE OR REPLACE FUNCTION public.generate_product_code(p_product_id uuid, p_category text, p_code_id uuid, p_date_option text, p_max_sequence integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  SELECT code_series INTO v_existing_series
  FROM products WHERE id = p_product_id;
  IF v_existing_series IS NOT NULL THEN
    RETURN NULL;
  END IF;

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

  SELECT cs.value INTO v_format
  FROM cms_settings cs WHERE cs.key = 'product_code_format';
  IF v_format IS NULL THEN
    v_format := '{"prefix":"CS","date_format":"YYMM","seq_digits":3,"reset_monthly":true,"suffix":""}'::JSONB;
  END IF;
  IF v_code_rule IS NOT NULL THEN v_format := v_format || v_code_rule; END IF;

  v_prefix     := COALESCE(NULLIF(v_format->>'prefix', ''), 'CS');
  v_seq_digits := COALESCE((v_format->>'seq_digits')::INT, 3);
  v_suffix     := COALESCE(v_format->>'suffix', '');

  CASE p_date_option
    WHEN 'none' THEN v_year_month := 'nodate';
    WHEN 'ymd'  THEN v_year_month := TO_CHAR(NOW(), 'YYMMDD');
    ELSE             v_year_month := TO_CHAR(NOW(), 'YYMM');
  END CASE;

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
$function$;

-- 2-4. (p_product_id, p_category, p_code_id, p_date_option, p_max_sequence, p_parent_max_sequence) — 6-param
CREATE OR REPLACE FUNCTION public.generate_product_code(p_product_id uuid, p_category text, p_code_id uuid, p_date_option text, p_max_sequence integer, p_parent_max_sequence integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  SELECT code_series INTO v_existing_series
  FROM products WHERE id = p_product_id;
  IF v_existing_series IS NOT NULL THEN
    RETURN NULL;
  END IF;

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

  SELECT cs.value INTO v_format
  FROM cms_settings cs WHERE cs.key = 'product_code_format';
  IF v_format IS NULL THEN
    v_format := '{"prefix":"CS","date_format":"YYMM","seq_digits":3,"reset_monthly":true,"suffix":""}'::JSONB;
  END IF;
  IF v_code_rule IS NOT NULL THEN v_format := v_format || v_code_rule; END IF;

  v_prefix     := COALESCE(NULLIF(v_format->>'prefix', ''), 'CS');
  v_seq_digits := COALESCE((v_format->>'seq_digits')::INT, 3);
  v_suffix     := COALESCE(v_format->>'suffix', '');

  CASE p_date_option
    WHEN 'none' THEN v_year_month := 'nodate';
    WHEN 'ymd'  THEN v_year_month := TO_CHAR(NOW(), 'YYMMDD');
    ELSE             v_year_month := TO_CHAR(NOW(), 'YYMM');
  END CASE;

  IF p_parent_max_sequence IS NOT NULL THEN
    v_parent_seq_digits := LENGTH(p_parent_max_sequence::TEXT);
  ELSE
    v_parent_seq_digits := v_seq_digits;
  END IF;

  INSERT INTO product_parent_sequences (category_code, year_month, next_seq)
  VALUES (v_cat_code, COALESCE(v_year_month, 'nodate'), 2)
  ON CONFLICT (category_code, year_month)
  DO UPDATE SET next_seq = product_parent_sequences.next_seq + 1
  RETURNING product_parent_sequences.next_seq - 1 INTO v_parent_seq;
  IF v_parent_seq IS NULL THEN v_parent_seq := 1; END IF;

  IF p_parent_max_sequence IS NOT NULL AND v_parent_seq > p_parent_max_sequence THEN
    RAISE EXCEPTION 'parent_max_sequence_exceeded: 이 조합코드(%)의 부모 순번 상한(%)에 도달했습니다. 코드설정에서 순번1 상한을 늘려주세요.',
      v_cat_code, p_parent_max_sequence
      USING ERRCODE = 'P0001';
  END IF;

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

  RETURN NULL;
END;
$function$;

-- 2-5. (..., p_category_code_override) — 7-param, 최신 버전(#239 seq_digits 버그 수정 포함)
CREATE OR REPLACE FUNCTION public.generate_product_code(p_product_id uuid, p_category text, p_code_id uuid, p_date_option text, p_max_sequence integer, p_parent_max_sequence integer, p_category_code_override text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF p_category_code_override IS NOT NULL THEN
    v_cat_code := p_category_code_override;
    IF p_code_id IS NOT NULL THEN
      SELECT pcc.code_rule INTO v_code_rule
      FROM   product_category_codes pcc
      WHERE  pcc.id = p_code_id
        AND  pcc.is_active = TRUE AND pcc.deleted_at IS NULL;
    END IF;
  ELSE
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
  FROM cms_settings cs WHERE cs.key = 'product_code_format';
  IF v_format IS NULL THEN
    v_format := '{"prefix":"CS","date_format":"YYMM","seq_digits":3,"reset_monthly":true,"suffix":""}'::JSONB;
  END IF;
  IF v_code_rule IS NOT NULL THEN v_format := v_format || v_code_rule; END IF;

  v_prefix     := COALESCE(NULLIF(v_format->>'prefix', ''), 'CS');
  v_seq_digits := COALESCE((v_format->>'seq_digits')::INT, 3);
  v_suffix     := COALESCE(v_format->>'suffix', '');

  -- 🔴 버그 수정(#239): 순번2(자식) 상한이 명시적으로 설정됐으면 그 자릿수를 그대로 반영한다.
  IF p_max_sequence IS NOT NULL THEN
    v_seq_digits := LENGTH(p_max_sequence::TEXT);
  END IF;

  -- ③ date_option → year_month 결정
  CASE p_date_option
    WHEN 'none' THEN v_year_month := 'nodate';
    WHEN 'ymd'  THEN v_year_month := TO_CHAR(NOW(), 'YYMMDD');
    ELSE             v_year_month := TO_CHAR(NOW(), 'YYMM');
  END CASE;

  -- ④ 순번1(부모) 모드 분기
  IF p_parent_max_sequence IS NOT NULL THEN
    v_parent_seq_digits := LENGTH(p_parent_max_sequence::TEXT);

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
$function$;
