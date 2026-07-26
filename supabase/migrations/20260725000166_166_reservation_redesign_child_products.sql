-- Migration 166: 예약 시스템 재설계 — 자식 상품(재고 단위) 기반
-- 목적:
--   1. rental_reservations.asset_id nullable 전환 (물리 자산은 출고 시 연결, 예약 시 불필요)
--   2. create_hold_reservation → 자식 상품(child product) 기반으로 재설계
--   3. auto_create_inventory_for_product RPC 신규 생성 (신규 상품 등록 시 재고 1개 자동 생성)
--   4. 기존 자식 상품이 없는 상품에 재고 1개 자동 생성 (데이터 마이그레이션)
--
-- 설계 원칙:
--   · 재고 단위 = 자식 상품 (parent_product_id 있음, is_active=false)
--   · 각 재고는 generate_inventory_product_code 로 순차 품번 발행
--   · '2개 재고' = 자식 상품 2개 행, 각각 독립 품번 보유
--   · assets 테이블은 물리 자산 QR·시리얼 관리 전용 (예약 가용성 판단과 분리)

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 1: rental_reservations.asset_id → nullable 전환
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.rental_reservations ALTER COLUMN asset_id DROP NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 2: 기존 asset_id 기반 GIST 제외 제약 조건 제거 (있을 경우)
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  cname text;
BEGIN
  FOR cname IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.rental_reservations'::regclass
      AND con.contype = 'x'
  LOOP
    EXECUTE format('ALTER TABLE public.rental_reservations DROP CONSTRAINT IF EXISTS %I', cname);
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 3: product_id 기반 GIST 중복 예약 방지 제약 추가
-- (동일 재고 단위=자식 상품에 날짜 겹치는 활성 예약 불가)
-- ────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.rental_reservations
  ADD CONSTRAINT rental_reservations_product_dates_excl
  EXCLUDE USING gist (
    product_id WITH =,
    daterange(start_date, end_date + 1, '[)') WITH &&
  )
  WHERE (status NOT IN ('cancelled', 'returned', 'completed', 'expired'));

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 4: auto_create_inventory_for_product RPC
-- 신규 상품 등록 또는 데이터 마이그레이션 시 재고 1개(자식 상품) 자동 생성
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
  -- 부모 상품 조회 (루트 상품이어야 함)
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

  -- 자식 상품 INSERT
  --   is_active = false : 사용자 상품 목록 미노출
  --   slug 고유성: gen_random_uuid() 접미사로 보장
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
    false,
    v_parent.sale_price,
    v_parent.sale_only
  )
  RETURNING id INTO v_child_id;

  -- 재고 품번 자동 발행 (시퀀스 미등록 등 실패 시 WARNING만, 자식 상품은 유지)
  IF v_parent.product_code IS NOT NULL THEN
    BEGIN
      PERFORM generate_inventory_product_code(v_child_id, p_product_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'inventory code generation skipped for %: %', v_child_id, SQLERRM;
    END;
  END IF;

  -- 가격 규칙 복사
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
-- STEP 5: create_hold_reservation v2 — 자식 상품(재고 단위) 기반
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
  --   · parent_product_id = p_product_id 인 자식 상품만 대상
  --   · 해당 기간에 활성 예약이 없는 것 중 가장 먼저 생성된 단위
  --   · FOR UPDATE SKIP LOCKED: 동시 예약 시 이미 처리 중인 단위 건너뜀
  SELECT p.id INTO v_unit_id
  FROM products p
  WHERE p.parent_product_id = p_product_id
    AND p.deleted_at IS NULL
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
  --   · product_id = v_unit_id (자식 상품 ID — 특정 재고 단위)
  --   · asset_id = NULL (물리 자산은 출고 시 CMS에서 연결)
  --   · reservation_code: rental_reservations 테이블 DEFAULT (generate_reservation_code) 자동 생성
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
-- STEP 6: 데이터 마이그레이션 — 기존 상품 중 자식 상품 없는 경우 재고 1개 자동 생성
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r RECORD;
  v_created INT := 0;
  v_failed  INT := 0;
BEGIN
  FOR r IN
    SELECT p.id
    FROM products p
    WHERE p.parent_product_id IS NULL
      AND p.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM products c
        WHERE c.parent_product_id = p.id
          AND c.deleted_at IS NULL
      )
    ORDER BY p.created_at
  LOOP
    BEGIN
      PERFORM auto_create_inventory_for_product(r.id);
      v_created := v_created + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'auto_create_inventory_for_product failed for %: %', r.id, SQLERRM;
      v_failed := v_failed + 1;
    END;
  END LOOP;

  RAISE NOTICE '재고 자동 생성 완료: 성공 %, 실패 %', v_created, v_failed;
END $$;
