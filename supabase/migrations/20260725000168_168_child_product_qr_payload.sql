-- Migration 168: 자식 상품(재고 단위) 전용 QR 코드 정합
-- 정책: 모든 상품은 독립적인 품번 + 전용 QR 코드를 각자 보유
--
-- STEP 1: auto_create_inventory_for_product — qr_payload 추가 (신규 생성 시 자동 부여)
-- STEP 2: 기존 자식 상품 qr_payload 백필 (null → 고유 URL)

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 1: auto_create_inventory_for_product v3 — qr_payload 포함
-- ────────────────────────────────────────────────────────────────────────────

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
         content_blocks, sale_price, sale_only, product_code
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

  IF v_parent.product_code IS NOT NULL THEN
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

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 2: 기존 자식 상품 qr_payload 백필
-- qr_payload IS NULL 인 자식 상품에만 적용 (기존 보유분 유지)
-- ────────────────────────────────────────────────────────────────────────────

UPDATE public.products
SET qr_payload = 'https://crazyshot.kr/qr/product/' || id
WHERE parent_product_id IS NOT NULL
  AND deleted_at IS NULL
  AND qr_payload IS NULL;
