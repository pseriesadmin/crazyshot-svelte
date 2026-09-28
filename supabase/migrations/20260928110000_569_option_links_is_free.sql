-- Migration #569: 옵션상품 개별 "무료 제공" 토글 (Stephen 지시, 2026-09-28)
--
-- product_option_links에 is_free 플래그를 추가해, 기존 필수선택(is_required)/최소1개선택
-- (min_select_required)/배송대여불가(delivery_rental_disabled)와 동일한 CMS 콤보버튼 패턴으로
-- 개별 옵션링크마다 "무료 제공" 여부를 설정할 수 있게 한다.
--
-- 과금 보안: 클라이언트(상품상세/장바구니)가 보내는 unit_price를 그대로 믿지 않고,
-- set_reservation_options RPC가 저장 시점에 product_option_links.is_free를 직접 조회해
-- true면 unit_price를 서버에서 무조건 0으로 덮어쓴다 — 클라이언트 조작으로 무료 옵션의
-- 요금이 새는 것을 구조적으로 차단.

ALTER TABLE product_option_links
  ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT false;

-- ─── upsert_product_option_links — is_free 저장 추가 ──────────────
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
      (product_id, option_product_id, is_required, min_select_required, delivery_rental_disabled, is_free, display_order)
    SELECT
      p_product_id,
      (el->>'option_product_id')::UUID,
      COALESCE((el->>'is_required')::BOOLEAN, false),
      COALESCE((el->>'min_select_required')::BOOLEAN, false),
      COALESCE((el->>'delivery_rental_disabled')::BOOLEAN, false),
      COALESCE((el->>'is_free')::BOOLEAN, false),
      COALESCE((el->>'display_order')::SMALLINT, 0)
    FROM jsonb_array_elements(p_option_links) AS el
    ON CONFLICT (product_id, option_product_id) DO UPDATE SET
      deleted_at               = NULL,
      is_required              = EXCLUDED.is_required,
      min_select_required      = EXCLUDED.min_select_required,
      delivery_rental_disabled = EXCLUDED.delivery_rental_disabled,
      is_free                  = EXCLUDED.is_free,
      display_order            = EXCLUDED.display_order,
      updated_at               = NOW();
  END IF;
END;
$$;

-- ─── set_reservation_options — is_free 옵션은 unit_price 서버측 강제 0원 ──
CREATE OR REPLACE FUNCTION set_reservation_options(p_reservation_id BIGINT, p_options JSONB)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_item RECORD;
  v_total_active INT;
  v_occupied_by_others INT;
  v_available INT;
  v_main_product_id UUID;
BEGIN
  SELECT product_id INTO v_main_product_id
  FROM rental_reservations
  WHERE id = p_reservation_id AND user_id = auth.uid() AND status IN ('draft', 'hold');

  IF v_main_product_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_item IN
    SELECT
      NULLIF(elem->>'option_product_id', '')::UUID AS option_product_id,
      COALESCE((elem->>'qty')::INTEGER, 0) AS qty
    FROM jsonb_array_elements(p_options) AS elem
    WHERE COALESCE((elem->>'qty')::INTEGER, 0) > 0
  LOOP
    CONTINUE WHEN v_item.option_product_id IS NULL;

    SELECT COUNT(*) INTO v_total_active
    FROM products c
    WHERE c.parent_product_id = v_item.option_product_id
      AND c.is_active = true AND c.deleted_at IS NULL;

    SELECT COALESCE(SUM(ro.qty), 0) INTO v_occupied_by_others
    FROM reservation_options ro
    JOIN rental_reservations rr ON rr.id = ro.reservation_id
    WHERE ro.option_product_id = v_item.option_product_id
      AND ro.reservation_id != p_reservation_id
      AND rr.status IN ('hold', 'confirmed', 'shipped', 'in_use', 'return_requested');

    v_available := GREATEST(0, v_total_active - v_occupied_by_others);

    IF v_item.qty > v_available THEN
      RAISE EXCEPTION 'OPTION_STOCK_EXCEEDED:%', v_item.option_product_id;
    END IF;
  END LOOP;

  DELETE FROM reservation_options WHERE reservation_id = p_reservation_id;

  -- PRICE-FREE-1: option_product_id가 이 예약의 메인상품(v_main_product_id) 기준
  -- product_option_links에서 is_free=true로 설정돼 있으면 unit_price를 무조건 0으로
  -- 강제한다 — 클라이언트가 다른 값을 보내도 무시(과금 보안).
  INSERT INTO reservation_options (reservation_id, option_product_id, option_name, qty, unit_price)
  SELECT
    p_reservation_id,
    NULLIF(elem->>'option_product_id', '')::UUID,
    elem->>'option_name',
    (elem->>'qty')::INTEGER,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM product_option_links pol
        WHERE pol.product_id = v_main_product_id
          AND pol.option_product_id = NULLIF(elem->>'option_product_id', '')::UUID
          AND pol.deleted_at IS NULL
          AND pol.is_free = true
      ) THEN 0
      ELSE COALESCE((elem->>'unit_price')::NUMERIC, 0)
    END
  FROM jsonb_array_elements(p_options) AS elem
  WHERE COALESCE((elem->>'qty')::INTEGER, 0) > 0;
END;
$$;

-- ─── get_product_option_links — is_free 반환 컬럼 추가 ──────────────
-- RETURNS TABLE 컬럼 목록 변경은 CREATE OR REPLACE로 불가(42P13) — DROP 후 재생성 필요.
-- 기존 grantee(anon·authenticated·service_role) 그대로 재부여.
DROP FUNCTION IF EXISTS public.get_product_option_links(uuid);

CREATE FUNCTION public.get_product_option_links(p_product_id uuid)
RETURNS TABLE(link_id uuid, option_product_id uuid, option_product_name text, price_24h numeric, stock_quantity integer, is_required boolean, min_select_required boolean, delivery_rental_disabled boolean, is_free boolean, display_order smallint, image_url text)
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
