-- migration #158: product_wishlists — 찜(관심상품) 테이블 + RPC
-- Dependencies: 04_products.sql

-- 1. 찜 테이블
CREATE TABLE IF NOT EXISTS product_wishlists (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT product_wishlists_user_product_unique UNIQUE (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_pw_user ON product_wishlists(user_id, created_at DESC);

ALTER TABLE product_wishlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pw_select_own" ON product_wishlists
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "pw_insert_own" ON product_wishlists
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "pw_delete_own" ON product_wishlists
  FOR DELETE USING (auth.uid() = user_id);

-- 2. 토글 RPC (찜 추가 / 취소)
CREATE OR REPLACE FUNCTION toggle_product_wishlist(
  p_product_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_exists  BOOLEAN;
  v_action  TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '로그인 필요');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM product_wishlists
    WHERE user_id = v_user_id AND product_id = p_product_id
  ) INTO v_exists;

  IF v_exists THEN
    DELETE FROM product_wishlists
    WHERE user_id = v_user_id AND product_id = p_product_id;
    v_action := 'removed';
  ELSE
    INSERT INTO product_wishlists (user_id, product_id)
    VALUES (v_user_id, p_product_id)
    ON CONFLICT (user_id, product_id) DO NOTHING;
    v_action := 'added';
  END IF;

  RETURN jsonb_build_object('ok', true, 'action', v_action);
END;
$$;

-- 3. 찜 목록 조회 RPC (상품 정보 + 가격 JOIN)
CREATE OR REPLACE FUNCTION get_user_wishlists(
  p_user_id UUID
) RETURNS TABLE (
  wishlist_id  UUID,
  product_id   UUID,
  product_name VARCHAR,
  category     TEXT,
  image_url    TEXT,
  slug         VARCHAR,
  price24h     NUMERIC,
  price12h     NUMERIC,
  wished_at    TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- 호출자 본인 또는 관리자만 허용
  IF auth.uid() != p_user_id AND NOT is_admin() THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    pw.id                         AS wishlist_id,
    p.id                          AS product_id,
    p.name                        AS product_name,
    p.category::TEXT              AS category,
    COALESCE(p.image_urls[1], '') AS image_url,
    p.slug                        AS slug,
    MAX(pr24.price)               AS price24h,
    MAX(pr12.price)               AS price12h,
    pw.created_at                 AS wished_at
  FROM product_wishlists pw
  JOIN products p ON p.id = pw.product_id
    AND p.deleted_at IS NULL AND p.is_active = true
  LEFT JOIN price_rules pr24 ON pr24.product_id = p.id
    AND pr24.duration_type = '24h' AND pr24.deleted_at IS NULL AND pr24.is_active = true
  LEFT JOIN price_rules pr12 ON pr12.product_id = p.id
    AND pr12.duration_type = '12h' AND pr12.deleted_at IS NULL AND pr12.is_active = true
  WHERE pw.user_id = p_user_id
  GROUP BY pw.id, p.id, p.name, p.category, p.image_urls, p.slug, pw.created_at
  ORDER BY pw.created_at DESC;
END;
$$;
