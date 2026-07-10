-- Migration #96: product_code 무결성 강화
-- HIGH-1: 배정된 product_code를 NULL로 되돌리는 것 차단 (트리거)
--         → INSERT(NULL) → UPDATE(코드배정) 2단계 플로우는 유지
--         → 코드 삭제로 인한 고아 상품 발생 방지
-- HIGH-2: product_code 부분 인덱스 추가 — QR 품번 조회 성능 보장
-- ─────────────────────────────────────────────────────────────────────────────

-- HIGH-2: 부분 인덱스 (NULL 제외 — 의미 있는 코드만 인덱싱)
CREATE INDEX IF NOT EXISTS idx_products_product_code
  ON products (product_code)
  WHERE product_code IS NOT NULL;

-- HIGH-1: product_code NULL 퇴행 방지 트리거 함수
CREATE OR REPLACE FUNCTION prevent_product_code_nullification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 이미 코드가 배정된 상품의 product_code를 NULL로 바꾸려는 시도 차단
  IF OLD.product_code IS NOT NULL AND NEW.product_code IS NULL THEN
    RAISE EXCEPTION
      'product_code_protected: product_code cannot be set to NULL once assigned (product_id: %)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

-- 트리거 등록 (UPDATE 시만 실행 — INSERT는 영향 없음)
DROP TRIGGER IF EXISTS trg_prevent_product_code_null ON products;
CREATE TRIGGER trg_prevent_product_code_null
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION prevent_product_code_nullification();

COMMENT ON FUNCTION prevent_product_code_nullification() IS
  '배정된 product_code를 NULL로 되돌리는 UPDATE 차단 — 고아 상품 방지';
