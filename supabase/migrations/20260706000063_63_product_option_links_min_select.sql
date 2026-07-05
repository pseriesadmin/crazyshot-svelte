-- Migration 63: product_option_links.min_select_required 컬럼 추가
-- 사전조건: migration 62(product_option_links) 완료 필수
-- 목적: CMS 옵션상품 설정 UI "최소 1개 선택 필수" 체크박스 DB 반영

-- ─── 컬럼 추가 ────────────────────────────────────────────────
ALTER TABLE public.product_option_links
  ADD COLUMN IF NOT EXISTS min_select_required BOOLEAN NOT NULL DEFAULT false;

-- ─── RPC 1 업데이트: upsert_product_option_links ─────────────
-- min_select_required 파라미터 반영
CREATE OR REPLACE FUNCTION upsert_product_option_links(
  p_product_id   UUID,
  p_option_links JSONB
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE product_option_links
    SET deleted_at = NOW(), updated_at = NOW()
  WHERE product_id = p_product_id AND deleted_at IS NULL;

  IF jsonb_array_length(p_option_links) > 0 THEN
    INSERT INTO product_option_links
      (product_id, option_product_id, is_required, min_select_required, delivery_rental_disabled, display_order)
    SELECT
      p_product_id,
      (el->>'option_product_id')::UUID,
      COALESCE((el->>'is_required')::BOOLEAN, false),
      COALESCE((el->>'min_select_required')::BOOLEAN, false),
      COALESCE((el->>'delivery_rental_disabled')::BOOLEAN, false),
      COALESCE((el->>'display_order')::SMALLINT, 0)
    FROM jsonb_array_elements(p_option_links) AS el;
  END IF;
END;
$$;

-- ─── RPC 2 업데이트: get_product_option_links ─────────────────
-- min_select_required 반환 컬럼 추가
CREATE OR REPLACE FUNCTION get_product_option_links(p_product_id UUID)
RETURNS TABLE(
  link_id                  UUID,
  option_product_id        UUID,
  option_product_name      TEXT,
  price_24h                NUMERIC,
  stock_quantity           INT,
  is_required              BOOLEAN,
  min_select_required      BOOLEAN,
  delivery_rental_disabled BOOLEAN,
  display_order            SMALLINT,
  image_url                TEXT
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    pol.id                   AS link_id,
    pol.option_product_id,
    p.name                   AS option_product_name,
    pr.price                 AS price_24h,
    p.stock_quantity,
    pol.is_required,
    pol.min_select_required,
    pol.delivery_rental_disabled,
    pol.display_order,
    p.image_urls[1]          AS image_url
  FROM product_option_links pol
  JOIN products p ON p.id = pol.option_product_id AND p.deleted_at IS NULL
  LEFT JOIN price_rules pr
    ON pr.product_id = pol.option_product_id
    AND pr.duration_type = '24h'
    AND pr.is_active = true
    AND pr.deleted_at IS NULL
  WHERE pol.product_id = p_product_id
    AND pol.deleted_at IS NULL
  ORDER BY pol.display_order ASC;
$$;

-- ─── 검증 ─────────────────────────────────────────────────────
DO $$
DECLARE v_col_exists BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'product_option_links'
      AND column_name = 'min_select_required'
  ) INTO v_col_exists;
  IF NOT v_col_exists THEN
    RAISE EXCEPTION 'FAIL: min_select_required column not found';
  END IF;
  RAISE NOTICE 'Migration 63 OK: min_select_required column added + RPC updated';
END;
$$;
