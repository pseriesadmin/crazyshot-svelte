-- Migration #99: 재고 복제 품번 채번 RPC
-- 목적: 빠른 재고 등록(add_inventory)에서 부모 품번과 동일한 시리즈로 자식 품번을 채번
-- 문제: generate_child_product_code는 부모코드+A+형제수 방식으로 CSLENCOM2607001A003을 생성
--       → 부모와 동일 시리즈(CSLENCOM2607002, 003...) 채번이 불가능했음
-- 해결: 부모 product_code를 product_code_sequences에서 역산해 동일 시퀀스에서 원자적 채번
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION generate_inventory_product_code(
  p_product_id        UUID,
  p_parent_product_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_code   TEXT;
  v_category_code TEXT;
  v_year_month    TEXT;
  v_seq_digits    INT;
  v_seq           INT;
  v_date_part     TEXT;
  v_child_code    TEXT;
BEGIN
  -- 이미 품번이 있으면 그대로 반환
  SELECT product_code INTO v_child_code
  FROM products WHERE id = p_product_id;
  IF v_child_code IS NOT NULL THEN RETURN v_child_code; END IF;

  -- 부모 품번 조회
  SELECT product_code INTO v_parent_code
  FROM products WHERE id = p_parent_product_id AND deleted_at IS NULL;

  IF v_parent_code IS NULL THEN
    RAISE EXCEPTION '부모 상품에 품번이 없습니다. (parent_product_id: %)', p_parent_product_id;
  END IF;

  -- 부모 코드에 해당하는 product_code_sequences 행 탐색
  -- 매칭 패턴: 'CS' || category_code || (nodate→'' / 그 외→year_month) 로 시작하는 코드
  -- ORDER BY 매칭 길이 DESC → 가장 구체적인 시퀀스 우선
  SELECT
    pcs.category_code,
    pcs.year_month,
    LENGTH(
      'CS' || pcs.category_code ||
      CASE WHEN pcs.year_month = 'nodate' THEN '' ELSE pcs.year_month END
    ) AS match_len
  INTO v_category_code, v_year_month
  FROM product_code_sequences pcs
  WHERE v_parent_code LIKE
    'CS' || pcs.category_code ||
    CASE WHEN pcs.year_month = 'nodate' THEN '' ELSE pcs.year_month END || '%'
  ORDER BY match_len DESC
  LIMIT 1;

  IF v_category_code IS NULL THEN
    RAISE EXCEPTION '부모 품번(%)에 해당하는 시퀀스를 찾을 수 없습니다. product_code_sequences를 확인해주세요.', v_parent_code;
  END IF;

  -- 날짜 파트 계산 (nodate는 빈 문자열로 코드에 포함되지 않음)
  v_date_part := CASE WHEN v_year_month = 'nodate' THEN '' ELSE v_year_month END;

  -- 시퀀스 자리수: 부모 코드 전체 길이 - prefix(2) - category_code 길이 - 날짜 파트 길이
  v_seq_digits := LENGTH(v_parent_code) - 2 - LENGTH(v_category_code) - LENGTH(v_date_part);

  IF v_seq_digits < 1 THEN
    v_seq_digits := 3; -- fallback
  END IF;

  -- 원자적 채번
  UPDATE product_code_sequences
  SET next_seq = next_seq + 1
  WHERE category_code = v_category_code AND year_month = v_year_month
  RETURNING next_seq - 1 INTO v_seq;

  IF v_seq IS NULL THEN
    RAISE EXCEPTION '시퀀스 채번에 실패했습니다. (category_code: %, year_month: %)', v_category_code, v_year_month;
  END IF;

  -- 자식 품번 조합: CS + category_code + date_part + seq
  v_child_code := 'CS' || v_category_code || v_date_part || LPAD(v_seq::TEXT, v_seq_digits, '0');

  -- 자식 상품에 품번 기록
  UPDATE products SET product_code = v_child_code WHERE id = p_product_id;

  RETURN v_child_code;
END;
$$;

COMMENT ON FUNCTION generate_inventory_product_code(UUID, UUID) IS
  '빠른 재고 등록 전용: 부모 품번(product_code)의 시퀀스 시리즈를 역산해 동일 체계로 자식 품번 채번.
   예) 부모 CSLENCOM2607001 → 자식 CSLENCOM2607005 (LENCOM/2607 시퀀스 다음 번호).
   generate_child_product_code(부모코드+A+형제수 방식) 대체.';
