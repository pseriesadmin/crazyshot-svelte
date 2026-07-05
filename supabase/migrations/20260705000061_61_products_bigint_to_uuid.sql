-- =============================================================
-- Migration 61: products 스키마 근본 해결
--   1) products.id bigint → UUID (8행 보존)
--   2) products 누락 컬럼 추가 (slug, brand, is_active, image_urls, specifications, stock_quantity, deleted_at)
--   3) price_rules 테이블 생성 (migration 62 의존)
--   4) child FK 테이블 product_id bigint → UUID
--   5) RPC 함수 2개 업데이트 (atomic_reserve_asset, batch_atomic_reserve)
-- 대상: stage(ezyvffjvuwmtuhpxdjrw) → production(vnbpmvxruyciuuaermyh)
-- =============================================================

-- ============================================================
-- PHASE 1: child 테이블 FK 제약 해제
-- ============================================================

ALTER TABLE public.assets
  DROP CONSTRAINT IF EXISTS assets_product_id_fkey;

ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS order_items_product_id_fkey;

ALTER TABLE public.rental_reservations
  DROP CONSTRAINT IF EXISTS rental_reservations_product_id_fkey;

-- ============================================================
-- PHASE 2: products.id bigint → UUID (기존 8행 보존)
-- ============================================================

-- 2a. UUID 컬럼 추가
ALTER TABLE public.products
  ADD COLUMN _new_id UUID DEFAULT gen_random_uuid();

-- 2b. 기존 PK 제약 제거
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_pkey;

-- 2c. 기존 bigint id 컬럼 제거
ALTER TABLE public.products
  DROP COLUMN id;

-- 2d. _new_id → id 로 rename
ALTER TABLE public.products
  RENAME COLUMN _new_id TO id;

-- 2e. UUID PK 설정 + DEFAULT 보장
ALTER TABLE public.products
  ADD PRIMARY KEY (id);

ALTER TABLE public.products
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- 2f. 고아 시퀀스 정리
DROP SEQUENCE IF EXISTS public.products_id_seq;

-- ============================================================
-- PHASE 3: products 누락 컬럼 추가
-- (CMS + migration 62 에서 참조하는 컬럼)
-- ============================================================

-- deleted_at 먼저 추가 (slug 인덱스가 의존)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- slug: 새 상품에는 필수, 기존 데이터는 NULL 허용 (UNIQUE → NULL은 허용)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS slug TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS products_slug_unique_idx
  ON public.products (slug)
  WHERE slug IS NOT NULL AND deleted_at IS NULL;

-- brand (optional)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS brand TEXT;

-- is_active: 기존 status 컬럼 기반으로 기본값 true
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- image_urls: JSONB 배열, 기본 빈 배열
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS image_urls JSONB NOT NULL DEFAULT '[]'::jsonb;

-- specifications: JSONB 키-값, 기본 빈 객체
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS specifications JSONB NOT NULL DEFAULT '{}'::jsonb;

-- stock_quantity: 기본 0
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS stock_quantity INTEGER NOT NULL DEFAULT 0;

-- ============================================================
-- PHASE 4: price_rules 테이블 생성 (migration 62 의존)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.price_rules (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id            UUID        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  duration_type         TEXT        NOT NULL CHECK (duration_type IN ('12h', '24h', 'monthly')),
  price                 NUMERIC     NOT NULL DEFAULT 0,
  deposit_amount        NUMERIC     NOT NULL DEFAULT 0,
  late_fee_per_hour     NUMERIC     NOT NULL DEFAULT 0,
  damage_fee_percentage NUMERIC     NOT NULL DEFAULT 0 CHECK (damage_fee_percentage >= 0 AND damage_fee_percentage <= 100),
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ,
  UNIQUE(product_id, duration_type)
);

-- price_rules RLS
ALTER TABLE public.price_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_price_rules" ON public.price_rules
  FOR SELECT USING (is_active = true AND deleted_at IS NULL);

CREATE POLICY "admin_all_price_rules" ON public.price_rules
  FOR ALL USING (public.is_cms_user());

-- price_rules updated_at 트리거
CREATE OR REPLACE FUNCTION public.update_price_rules_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_price_rules_updated_at
  BEFORE UPDATE ON public.price_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_price_rules_updated_at();

-- ============================================================
-- PHASE 5: child 테이블 product_id bigint → UUID
-- (모두 빈 테이블 — drop/add 패턴, NOT NULL 유지)
-- ============================================================

ALTER TABLE public.assets DROP COLUMN product_id;
ALTER TABLE public.assets ADD COLUMN product_id UUID NOT NULL;

ALTER TABLE public.order_items DROP COLUMN product_id;
ALTER TABLE public.order_items ADD COLUMN product_id UUID NOT NULL;

ALTER TABLE public.rental_reservations DROP COLUMN product_id;
ALTER TABLE public.rental_reservations ADD COLUMN product_id UUID NOT NULL;

-- ============================================================
-- PHASE 6: FK 제약 복원
-- ============================================================

ALTER TABLE public.assets
  ADD CONSTRAINT assets_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES public.products(id);

ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES public.products(id);

ALTER TABLE public.rental_reservations
  ADD CONSTRAINT rental_reservations_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES public.products(id);

-- ============================================================
-- PHASE 7: RPC 함수 업데이트 (p_product_id bigint → uuid)
-- ============================================================

-- 7a. atomic_reserve_asset: 파라미터 타입 변경
DROP FUNCTION IF EXISTS public.atomic_reserve_asset(bigint, date, date);

CREATE OR REPLACE FUNCTION public.atomic_reserve_asset(
  p_product_id UUID,
  p_start_date DATE,
  p_end_date   DATE
)
RETURNS TABLE (
  reservation_id BIGINT,
  asset_id       BIGINT,
  success        BOOLEAN,
  error_message  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id        UUID;
  v_asset_id       BIGINT;
  v_reservation_id BIGINT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  BEGIN
    SELECT id INTO v_asset_id
    FROM public.assets
    WHERE product_id = p_product_id
      AND status = 'available'
    LIMIT 1
    FOR UPDATE;

    IF v_asset_id IS NULL THEN
      RETURN QUERY SELECT NULL::BIGINT, NULL::BIGINT, FALSE, 'No available assets';
      RETURN;
    END IF;

    INSERT INTO public.rental_reservations
      (user_id, product_id, asset_id, start_date, end_date, status)
    VALUES
      (v_user_id, p_product_id, v_asset_id, p_start_date, p_end_date, 'confirmed')
    RETURNING id INTO v_reservation_id;

    UPDATE public.assets
    SET status = 'rented', updated_at = NOW()
    WHERE id = v_asset_id;

    RETURN QUERY SELECT v_reservation_id, v_asset_id, TRUE, NULL::TEXT;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT NULL::BIGINT, NULL::BIGINT, FALSE, SQLERRM;
  END;
END;
$$;

-- 7b. batch_atomic_reserve: 내부 타입 변경
DROP FUNCTION IF EXISTS public.batch_atomic_reserve(jsonb);

CREATE OR REPLACE FUNCTION public.batch_atomic_reserve(
  p_product_assets JSONB
)
RETURNS TABLE (
  reservation_id BIGINT,
  asset_id       BIGINT,
  success        BOOLEAN,
  error_message  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    UUID;
  v_item       JSONB;
  v_product_id UUID;
  v_start_date DATE;
  v_end_date   DATE;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  FOR v_item IN SELECT jsonb_array_elements(p_product_assets)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_start_date := (v_item->>'start_date')::DATE;
    v_end_date   := (v_item->>'end_date')::DATE;

    RETURN QUERY
    SELECT * FROM public.atomic_reserve_asset(v_product_id, v_start_date, v_end_date);
  END LOOP;
END;
$$;

-- ============================================================
-- PHASE 8: 검증
-- ============================================================
DO $$
DECLARE
  v_products_id_type       TEXT;
  v_assets_product_id_type TEXT;
  v_price_rules_exists     BOOLEAN;
BEGIN
  SELECT data_type INTO v_products_id_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'id';

  SELECT data_type INTO v_assets_product_id_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'assets' AND column_name = 'product_id';

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'price_rules'
  ) INTO v_price_rules_exists;

  IF v_products_id_type != 'uuid' THEN
    RAISE EXCEPTION 'FAIL: products.id is %, expected uuid', v_products_id_type;
  END IF;

  IF v_assets_product_id_type != 'uuid' THEN
    RAISE EXCEPTION 'FAIL: assets.product_id is %, expected uuid', v_assets_product_id_type;
  END IF;

  IF NOT v_price_rules_exists THEN
    RAISE EXCEPTION 'FAIL: price_rules table not created';
  END IF;

  RAISE NOTICE 'Migration 61 OK: products.id=uuid, assets.product_id=uuid, price_rules table exists';
END;
$$;
