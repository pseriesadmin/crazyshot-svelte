-- Migration #189: get_product_history_multi RPC — 부모 상품 이력 탭 자식 집계용
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → 필요 시 crazyshot production
-- 용도: 부모 상품 선택 시 자식(인벤토리) 전체의 이력을 한 번에 조회

CREATE OR REPLACE FUNCTION get_product_history_multi(p_product_ids UUID[])
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
    WHERE h.product_id = ANY(p_product_ids) AND h.deleted_at IS NULL
    ORDER BY h.recorded_date DESC, h.created_at DESC;
END;
$$;

-- == ROLLBACK ==
-- DROP FUNCTION IF EXISTS get_product_history_multi(UUID[]);
