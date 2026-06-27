-- 44_cms_taxonomy_rpcs.sql
-- CMS 분류체계 코드(product_category_codes) CRUD 전용 RPC
-- H-01/H-02 가드레일 준수: 서버에서 .insert()/.update() 직접 호출 금지 → RPC 경유
-- SECURITY DEFINER + anon/authenticated 실행 권한 제거 (service_role 전용)

-- ──────────────────────────────────────────────
-- 1. cms_add_taxonomy_code
--    새 분류코드 삽입 (depth·path_codes는 호출 측에서 계산 후 전달)
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cms_add_taxonomy_code(
  p_code             TEXT,
  p_name             TEXT,
  p_parent_id        UUID,
  p_depth            INT,
  p_path_codes       TEXT[],
  p_product_category TEXT,
  p_description      TEXT,
  p_sort_order       INT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO product_category_codes
    (code, name, parent_id, depth, path_codes, product_category, description, sort_order)
  VALUES
    (p_code, p_name, p_parent_id, p_depth, p_path_codes, p_product_category, p_description, p_sort_order);
END;
$$;

REVOKE EXECUTE ON FUNCTION cms_add_taxonomy_code(TEXT, TEXT, UUID, INT, TEXT[], TEXT, TEXT, INT)
  FROM anon, authenticated;

-- ──────────────────────────────────────────────
-- 2. cms_edit_taxonomy_code
--    코드명·설명·상품카테고리·정렬순서 수정
--    (코드 값 자체는 자산 무결성 보호를 위해 수정 불가)
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cms_edit_taxonomy_code(
  p_id               UUID,
  p_name             TEXT,
  p_description      TEXT,
  p_product_category TEXT,
  p_sort_order       INT
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
    description      = p_description,
    product_category = p_product_category,
    sort_order       = p_sort_order
  WHERE id = p_id
    AND deleted_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION cms_edit_taxonomy_code(UUID, TEXT, TEXT, TEXT, INT)
  FROM anon, authenticated;

-- ──────────────────────────────────────────────
-- 3. cms_delete_taxonomy_code
--    소프트 삭제 (deleted_at 기록, 하위 코드 존재 여부는 서버에서 선행 확인)
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cms_delete_taxonomy_code(
  p_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE product_category_codes
  SET deleted_at = NOW()
  WHERE id = p_id
    AND deleted_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION cms_delete_taxonomy_code(UUID)
  FROM anon, authenticated;

-- ──────────────────────────────────────────────
-- 4. cms_toggle_taxonomy_active
--    활성 상태 토글 (현재 값을 반전)
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cms_toggle_taxonomy_active(
  p_id      UUID,
  p_current BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE product_category_codes
  SET is_active = NOT p_current
  WHERE id = p_id
    AND deleted_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION cms_toggle_taxonomy_active(UUID, BOOLEAN)
  FROM anon, authenticated;
