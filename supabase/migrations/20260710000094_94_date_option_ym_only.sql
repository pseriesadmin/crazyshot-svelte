-- Migration #94: date_option 'ymd' 제거 — 년월(YYMM)만 사용
-- 이유: 일자정보 포함 시 코드가 지나치게 길어지는 문제 해결
--      'ymd'(연월일) 옵션을 'ym'(년월)으로 통일, YYMM(4자리) 형식 고정
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. 기존 'ymd' 데이터 → 'ym' 변환
UPDATE code_mapping_items
SET    date_option = 'ym'
WHERE  date_option = 'ymd';

-- 2. CHECK 제약 갱신 — 'ymd' 제거
ALTER TABLE code_mapping_items
  DROP   CONSTRAINT IF EXISTS code_mapping_items_date_option_check,
  ADD    CONSTRAINT code_mapping_items_date_option_check
         CHECK (date_option IN ('none', 'ym'));

-- 3. generate_product_code(5-param) — 'ymd' 분기 제거, 'ym'과 동일 처리
CREATE OR REPLACE FUNCTION generate_product_code(
  p_product_id   UUID,
  p_category     TEXT,
  p_code_id      UUID,
  p_date_option  TEXT,   -- 'none' | 'ym' (ymd는 ym과 동일 처리)
  p_max_sequence INT
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
  -- Guard: 이미 품번이 있으면 반환
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

  -- date_option → 년월 파트 결정 (YYMM 4자리 고정, ymd는 ym과 동일)
  IF p_date_option = 'none' THEN
    v_year_month := '';
  ELSE
    v_year_month := TO_CHAR(NOW(), 'YYMM');  -- 'ym' 및 레거시 'ymd' 모두 YYMM
  END IF;

  -- 시퀀스 키
  v_seq_key := CASE WHEN v_year_month = '' THEN 'nodate' ELSE v_year_month END;

  -- 순번 채번
  INSERT INTO product_code_sequences (category_code, year_month, next_seq)
  VALUES (v_cat_code, v_seq_key, 2)
  ON CONFLICT (category_code, year_month)
  DO UPDATE SET next_seq = product_code_sequences.next_seq + 1
  RETURNING next_seq - 1 INTO v_seq;

  -- max_sequence 상한 검사
  IF p_max_sequence IS NOT NULL AND p_max_sequence > 0 AND v_seq > p_max_sequence THEN
    RAISE EXCEPTION 'sequence_overflow: max=% current=%', p_max_sequence, v_seq;
  END IF;

  -- seq_digits: max_sequence 자리수 우선
  IF p_max_sequence IS NOT NULL AND p_max_sequence > 0 THEN
    v_seq_digits := LENGTH(p_max_sequence::TEXT);
  END IF;

  v_seq_padded  := LPAD(v_seq::TEXT, v_seq_digits, '0');
  v_product_code := v_prefix || v_cat_code || v_year_month || v_seq_padded || v_suffix;

  -- products 테이블에 기록
  UPDATE products SET product_code = v_product_code WHERE id = p_product_id;

  RETURN v_product_code;
END;
$$;

REVOKE ALL ON FUNCTION generate_product_code(UUID, TEXT, UUID, TEXT, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION generate_product_code(UUID, TEXT, UUID, TEXT, INT) TO service_role;
