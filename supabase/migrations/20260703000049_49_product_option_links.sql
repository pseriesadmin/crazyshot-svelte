-- Migration 49: product_option_links
-- 상품 간 옵션 연결 테이블 + RPC 2종
-- Stage 검증 후 Production 적용

-- ─── 테이블 ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_option_links (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id               UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  option_product_id        UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  is_required              BOOLEAN     NOT NULL DEFAULT false,
  delivery_rental_disabled BOOLEAN     NOT NULL DEFAULT false,
  display_order            SMALLINT    NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at               TIMESTAMPTZ,
  UNIQUE(product_id, option_product_id)
);

-- ─── RLS ──────────────────────────────────────────────────
ALTER TABLE product_option_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_option_links" ON product_option_links
  FOR SELECT USING (deleted_at IS NULL);

-- ─── updated_at 트리거 ─────────────────────────────────────
CREATE OR REPLACE FUNCTION update_product_option_links_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_product_option_links_updated_at
  BEFORE UPDATE ON product_option_links
  FOR EACH ROW EXECUTE FUNCTION update_product_option_links_updated_at();

-- ─── RPC 1: 옵션 저장 (soft-delete 후 재삽입) ───────────────
-- p_option_links: [{option_product_id, is_required, delivery_rental_disabled, display_order}]
CREATE OR REPLACE FUNCTION upsert_product_option_links(
  p_product_id   UUID,
  p_option_links JSONB
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- 기존 옵션 소프트딜리트
  UPDATE product_option_links
    SET deleted_at = NOW(), updated_at = NOW()
  WHERE product_id = p_product_id AND deleted_at IS NULL;

  -- 신규 삽입 (빈 배열이면 삽입 없음)
  IF jsonb_array_length(p_option_links) > 0 THEN
    INSERT INTO product_option_links
      (product_id, option_product_id, is_required, delivery_rental_disabled, display_order)
    SELECT
      p_product_id,
      (el->>'option_product_id')::UUID,
      COALESCE((el->>'is_required')::BOOLEAN, false),
      COALESCE((el->>'delivery_rental_disabled')::BOOLEAN, false),
      COALESCE((el->>'display_order')::SMALLINT, 0)
    FROM jsonb_array_elements(p_option_links) AS el;
  END IF;
END;
$$;

-- ─── RPC 2: 상세 페이지용 옵션 조회 ───────────────────────────
CREATE OR REPLACE FUNCTION get_product_option_links(p_product_id UUID)
RETURNS TABLE(
  link_id                  UUID,
  option_product_id        UUID,
  option_product_name      TEXT,
  price_24h                NUMERIC,
  stock_quantity           INT,
  is_required              BOOLEAN,
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
