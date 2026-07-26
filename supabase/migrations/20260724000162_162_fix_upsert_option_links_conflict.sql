-- Migration #162: upsert_product_option_links UNIQUE 충돌 수정
-- 원인: soft-delete 후 동일 (product_id, option_product_id) 재삽입 → UNIQUE 제약 위반
-- 수정: 제거 항목 하드딜리트 + 유지 항목 ON CONFLICT DO UPDATE (멱등 upsert)

CREATE OR REPLACE FUNCTION upsert_product_option_links(
  p_product_id   UUID,
  p_option_links JSONB
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  new_ids UUID[];
BEGIN
  -- 신규 목록의 option_product_id 배열 추출
  SELECT ARRAY(
    SELECT (el->>'option_product_id')::UUID
    FROM jsonb_array_elements(p_option_links) AS el
  ) INTO new_ids;

  -- 신규 목록에 없는 기존 행 하드딜리트 (soft-delete 사용 시 UNIQUE 재삽입 충돌 방지)
  DELETE FROM product_option_links
  WHERE product_id = p_product_id
    AND (deleted_at IS NULL OR deleted_at IS NOT NULL)  -- soft-deleted 포함 전체 정리
    AND (CARDINALITY(new_ids) = 0 OR option_product_id <> ALL(new_ids));

  -- 신규/변경 항목 UPSERT (ON CONFLICT: 기존 행 값 갱신)
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
    FROM jsonb_array_elements(p_option_links) AS el
    ON CONFLICT (product_id, option_product_id) DO UPDATE SET
      deleted_at               = NULL,
      is_required              = EXCLUDED.is_required,
      min_select_required      = EXCLUDED.min_select_required,
      delivery_rental_disabled = EXCLUDED.delivery_rental_disabled,
      display_order            = EXCLUDED.display_order,
      updated_at               = NOW();
  END IF;
END;
$$;
