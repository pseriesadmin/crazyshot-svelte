-- Migration #71: product_history_records 테이블 + RPC 3종 + update_asset_device_code RPC
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot production(vnbpmvxruyciuuaermyh)

-- 상품 이력 테이블
CREATE TABLE IF NOT EXISTS product_history_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  recorded_date DATE NOT NULL,
  -- images: [{url: text, thumb_url: text, comment: text(max50), display_order: int}]
  images        JSONB NOT NULL DEFAULT '[]',
  created_by    UUID NOT NULL REFERENCES auth.users(id),
  updated_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  deleted_at    TIMESTAMPTZ,
  CONSTRAINT max_20_images CHECK (jsonb_array_length(images) <= 20)
);

CREATE INDEX IF NOT EXISTS idx_history_product_date
  ON product_history_records(product_id, recorded_date DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE product_history_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cms_history_full" ON product_history_records
  FOR ALL USING (is_cms_user()) WITH CHECK (is_cms_user());

-- RPC 1: 목록 조회 (creator/updater email 포함)
CREATE OR REPLACE FUNCTION get_product_history(p_product_id UUID)
RETURNS TABLE(
  id UUID,
  product_id UUID,
  recorded_date DATE,
  images JSONB,
  created_by UUID,
  updated_by UUID,
  created_by_email TEXT,
  updated_by_email TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
    SELECT
      h.id,
      h.product_id,
      h.recorded_date,
      h.images,
      h.created_by,
      h.updated_by,
      cu.email::TEXT AS created_by_email,
      uu.email::TEXT AS updated_by_email,
      h.created_at,
      h.updated_at
    FROM product_history_records h
    LEFT JOIN auth.users cu ON cu.id = h.created_by
    LEFT JOIN auth.users uu ON uu.id = h.updated_by
    WHERE h.product_id = p_product_id AND h.deleted_at IS NULL
    ORDER BY h.recorded_date DESC, h.created_at DESC;
END;
$$;

-- RPC 2: upsert (신규/수정 통합)
CREATE OR REPLACE FUNCTION upsert_product_history_record(
  p_id UUID DEFAULT NULL,
  p_product_id UUID DEFAULT NULL,
  p_recorded_date DATE DEFAULT NULL,
  p_images JSONB DEFAULT '[]',
  p_user_id UUID DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_id IS NOT NULL THEN
    UPDATE product_history_records
      SET images = p_images,
          recorded_date = p_recorded_date,
          updated_by = p_user_id,
          updated_at = now()
      WHERE id = p_id AND deleted_at IS NULL
      RETURNING id INTO v_id;
  ELSE
    INSERT INTO product_history_records(product_id, recorded_date, images, created_by)
      VALUES (p_product_id, p_recorded_date, p_images, p_user_id)
      RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

-- RPC 3: soft delete
CREATE OR REPLACE FUNCTION delete_product_history_record(
  p_id UUID,
  p_user_id UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE product_history_records
    SET deleted_at = now(),
        updated_by = p_user_id
    WHERE id = p_id AND deleted_at IS NULL;
END;
$$;

-- Asset 장치코드 업데이트 RPC (모바일 OCR용)
CREATE OR REPLACE FUNCTION update_asset_device_code(
  p_asset_id UUID,
  p_asset_code TEXT DEFAULT NULL,
  p_serial_number TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE assets
    SET asset_code = COALESCE(p_asset_code, asset_code),
        serial_number = COALESCE(p_serial_number, serial_number),
        updated_at = now()
    WHERE id = p_asset_id AND deleted_at IS NULL;
END;
$$;

-- == ROLLBACK (참고용 — 실행 시 데이터 삭제됨) ==
-- DROP FUNCTION IF EXISTS update_asset_device_code(UUID, TEXT, TEXT);
-- DROP FUNCTION IF EXISTS delete_product_history_record(UUID, UUID);
-- DROP FUNCTION IF EXISTS upsert_product_history_record(UUID, UUID, DATE, JSONB, UUID);
-- DROP FUNCTION IF EXISTS get_product_history(UUID);
-- DROP TABLE IF EXISTS product_history_records CASCADE;
$$;
