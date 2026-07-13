-- Migration #82: generate_child_product_code RPC 신규
-- 목적: 재고 추가 복제 시 부모 품번 기반 자식 품번 생성
--       포맷: {부모품번}A{seq3}  예) CSCAM2607001A001, CSCAM2607001A002

CREATE OR REPLACE FUNCTION generate_child_product_code(
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
  v_sibling_count INT;
  v_child_code    TEXT;
BEGIN
  -- 부모 품번 조회
  SELECT product_code INTO v_parent_code
  FROM   products
  WHERE  id = p_parent_product_id;

  IF v_parent_code IS NULL THEN
    RAISE EXCEPTION '부모 상품에 품번이 없습니다. (parent_product_id: %)', p_parent_product_id;
  END IF;

  -- 기존 자식 수 조회 (순번 결정 — 이미 추가된 자식 포함)
  SELECT COUNT(*) INTO v_sibling_count
  FROM   products
  WHERE  parent_product_id = p_parent_product_id
    AND  deleted_at IS NULL;

  v_child_code := v_parent_code || 'A' || LPAD(v_sibling_count::TEXT, 3, '0');

  UPDATE products SET product_code = v_child_code WHERE id = p_product_id;

  RETURN v_child_code;
END;
$$;

REVOKE ALL ON FUNCTION generate_child_product_code(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION generate_child_product_code(UUID, UUID) TO service_role;
