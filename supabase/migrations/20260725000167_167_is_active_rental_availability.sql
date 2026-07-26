-- Migration 167: is_active 토글 → 대여 가용성 반영
-- 목적:
--   1. create_hold_reservation: is_active = true 자식 상품만 가용 재고로 선택
--   2. auto_create_inventory_for_product: 신규 자동 생성 재고 is_active = true 기본값
--   3. 기존 자동 생성 재고(is_active=false)를 is_active = true로 일괄 전환
--      (Migration 166 데이터 마이그레이션으로 생성된 자식 상품들)
--
-- 정책:
--   · on(is_active=true)  → 대여 가능 재고 (예약 시 할당 대상)
--   · off(is_active=false) → 대여 불가 재고 (예약 할당 제외)
--   · CMS 인벤토리 패널 토글로 관리자가 on/off 제어

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 1: create_hold_reservation v2 — is_active = true 필터 추가
-- ────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.create_hold_reservation(UUID, DATE, DATE);

CREATE FUNCTION public.create_hold_reservation(
  p_product_id UUID,
  p_start_date DATE,
  p_end_date   DATE
)
RETURNS TABLE (
  success         BOOLEAN,
  reservation_id  BIGINT,
  asset_id        BIGINT,
  error_message   TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id        UUID;
  v_unit_id        UUID;
  v_reservation_id BIGINT;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, NULL::BIGINT, '로그인이 필요합니다.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = v_user_id AND blacklisted = true
  ) THEN
    RETURN QUERY SELECT false, NULL::BIGINT, NULL::BIGINT, '서비스 이용이 제한된 계정입니다.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = v_user_id AND credit_score < 30
  ) THEN
    RETURN QUERY SELECT false, NULL::BIGINT, NULL::BIGINT, '신용점수가 낮아 예약이 제한됩니다.';
    RETURN;
  END IF;

  -- 가용 재고 단위(자식 상품) 탐색
  --   · is_active = true: 노출 on 상태의 재고만 대상 (off 재고는 대여 불가)
  --   · 해당 기간에 활성 예약이 없는 것 중 가장 먼저 생성된 단위
  --   · FOR UPDATE SKIP LOCKED: 동시 예약 시 이미 처리 중인 단위 건너뜀
  SELECT p.id INTO v_unit_id
  FROM products p
  WHERE p.parent_product_id = p_product_id
    AND p.deleted_at IS NULL
    AND p.is_active = true
    AND NOT EXISTS (
      SELECT 1
      FROM rental_reservations rr
      WHERE rr.product_id = p.id
        AND rr.status NOT IN ('cancelled', 'returned', 'completed', 'expired')
        AND daterange(rr.start_date, rr.end_date, '[]') &&
            daterange(p_start_date, p_end_date, '[]')
    )
  ORDER BY p.created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_unit_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, NULL::BIGINT, '해당 기간에 예약 가능한 재고가 없습니다.';
    RETURN;
  END IF;

  -- 예약 생성
  INSERT INTO rental_reservations (
    user_id, product_id, status,
    start_date, end_date,
    pickup_method, return_method
  )
  VALUES (
    v_user_id, v_unit_id, 'hold',
    p_start_date, p_end_date,
    'visit', 'visit'
  )
  RETURNING id INTO v_reservation_id;

  RETURN QUERY SELECT true, v_reservation_id, NULL::BIGINT, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, NULL::BIGINT, NULL::BIGINT, SQLERRM;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_hold_reservation(UUID, DATE, DATE) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 2: auto_create_inventory_for_product — is_active = true 기본값으로 변경
-- 신규 상품 등록 시 자동 생성되는 재고는 즉시 대여 가능 상태로 시작
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

  -- is_active = true: 신규 등록 상품의 기본 재고는 즉시 대여 가능
  INSERT INTO products (
    parent_product_id,
    name, slug, category, brand, description,
    image_urls, specifications, components, keywords,
    content_blocks, is_active, sale_price, sale_only
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
    v_parent.sale_only
  )
  RETURNING id INTO v_child_id;

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
-- STEP 3: 기존 자식 상품 is_active = true 일괄 전환
-- Migration 166 데이터 마이그레이션으로 생성된 자식 상품들이 is_active=false 상태
-- → 즉시 대여 가능하도록 전환 (관리자가 CMS에서 직접 off 처리 가능)
-- ────────────────────────────────────────────────────────────────────────────

UPDATE public.products
SET is_active = true
WHERE parent_product_id IS NOT NULL
  AND deleted_at IS NULL
  AND is_active = false;
