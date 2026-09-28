-- Migration #570: 옵션상품 개별 "수량 본상품 연동" 토글 (Stephen 지시, 2026-09-28)
--
-- product_option_links에 qty_follows_main 플래그를 추가 — is_free와 동일한 개별 옵션링크
-- 단위 토글. true인 옵션은 고객이 선택 여부를 고를 수 없이 항상 자동 포함되며(필수 옵션과
-- 동일하게), 수량이 본상품 예약 수량과 항상 같도록 강제된다. 수량 조절 UI는 화면에 계속
-- 노출하되 비활성(disabled) 상태로 표시만 한다 — 클라이언트(상품상세·장바구니) 단독 잠금이며
-- 서버(RPC)는 기존 재고초과 방지(OPTION_STOCK_EXCEEDED)만 그대로 유지한다(Stephen 확정 —
-- 구현 복잡도·회귀 위험 대비 서버측 그룹 재계산 로직은 이번 범위에서 제외).

ALTER TABLE product_option_links
  ADD COLUMN IF NOT EXISTS qty_follows_main BOOLEAN NOT NULL DEFAULT false;

-- ─── upsert_product_option_links — qty_follows_main 저장 추가 ──────
CREATE OR REPLACE FUNCTION upsert_product_option_links(p_product_id UUID, p_option_links JSONB)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  new_ids UUID[];
BEGIN
  SELECT ARRAY(
    SELECT (el->>'option_product_id')::UUID
    FROM jsonb_array_elements(p_option_links) AS el
  ) INTO new_ids;

  DELETE FROM product_option_links
  WHERE product_id = p_product_id
    AND (deleted_at IS NULL OR deleted_at IS NOT NULL)
    AND (CARDINALITY(new_ids) = 0 OR option_product_id <> ALL(new_ids));

  IF jsonb_array_length(p_option_links) > 0 THEN
    INSERT INTO product_option_links
      (product_id, option_product_id, is_required, min_select_required, delivery_rental_disabled, is_free, qty_follows_main, display_order)
    SELECT
      p_product_id,
      (el->>'option_product_id')::UUID,
      COALESCE((el->>'is_required')::BOOLEAN, false),
      COALESCE((el->>'min_select_required')::BOOLEAN, false),
      COALESCE((el->>'delivery_rental_disabled')::BOOLEAN, false),
      COALESCE((el->>'is_free')::BOOLEAN, false),
      COALESCE((el->>'qty_follows_main')::BOOLEAN, false),
      COALESCE((el->>'display_order')::SMALLINT, 0)
    FROM jsonb_array_elements(p_option_links) AS el
    ON CONFLICT (product_id, option_product_id) DO UPDATE SET
      deleted_at               = NULL,
      is_required              = EXCLUDED.is_required,
      min_select_required      = EXCLUDED.min_select_required,
      delivery_rental_disabled = EXCLUDED.delivery_rental_disabled,
      is_free                  = EXCLUDED.is_free,
      qty_follows_main         = EXCLUDED.qty_follows_main,
      display_order            = EXCLUDED.display_order,
      updated_at               = NOW();
  END IF;
END;
$$;

-- ─── get_product_option_links — qty_follows_main 반환 컬럼 추가 ────
DROP FUNCTION IF EXISTS public.get_product_option_links(uuid);

CREATE FUNCTION public.get_product_option_links(p_product_id uuid)
RETURNS TABLE(link_id uuid, option_product_id uuid, option_product_name text, price_24h numeric, stock_quantity integer, is_required boolean, min_select_required boolean, delivery_rental_disabled boolean, is_free boolean, qty_follows_main boolean, display_order smallint, image_url text)
LANGUAGE sql STABLE SECURITY DEFINER AS $function$
  SELECT
    pol.id                   AS link_id,
    pol.option_product_id,
    p.name                   AS option_product_name,
    pr.price                 AS price_24h,
    p.stock_quantity,
    pol.is_required,
    pol.min_select_required,
    pol.delivery_rental_disabled,
    pol.is_free,
    pol.qty_follows_main,
    pol.display_order,
    p.image_urls->>0         AS image_url
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
$function$;

GRANT EXECUTE ON FUNCTION public.get_product_option_links(uuid) TO anon, authenticated, service_role;
