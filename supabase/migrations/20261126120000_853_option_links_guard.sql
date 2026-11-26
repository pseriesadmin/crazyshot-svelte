-- Migration #853: 옵션상품 연결 저장(upsert_product_option_links) 서버 검증 추가 (Stephen 지시, 2026-11-26)
--
-- 배경: 결합상품 저장 함수(upsert_product_bundle_links)에는 자기참조·자식·삭제·중첩 검증이 있지만 옵션 저장 함수에는
--       검증이 전혀 없었다. 화면 자동완성 경로는 현재 상품 자신·재고 단위(자식)를 걸러내지 못한다.
--       ※ 패키지형 상품을 옵션으로 추가하는 것은 허용한다(Stephen 확정, 2026-11-26) — 차단하지 않는다.
--
-- 변경: "새로 추가되는 항목"에만 검증을 적용한다(이미 연결돼 있던 항목은 재저장해도 막지 않는다 — 기존 데이터 보호, Stage에 실사례 존재).
--   OPTION_SELF_REF        자기 자신 (항상 차단)
--   OPTION_CHILD_PRODUCT   재고 단위(자식) 상품
--   OPTION_DELETED_PRODUCT 삭제된 상품
--   OPTION_BUNDLE_OVERLAP  같은 상품의 결합 구성품(같은 실물이 두 역할을 맡는 것 방지)
-- 본문(삭제·UPSERT)은 #570과 동일. 빈 목록 저장(정리)은 항상 허용. 검증에 걸리면 예외로 전체 롤백.
-- ⚠️ #572는 결합상품 쪽에서 "옵션과 겹치는 상품"을 허용했다. 이번 OPTION_BUNDLE_OVERLAP은 옵션 쪽 신규 추가만 막으므로
--    "옵션 먼저 → 결합 나중"은 기존대로 가능하고 "결합 먼저 → 옵션 나중"만 차단된다(Stephen 지시 3번).
--
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh)
-- TDD: src/__tests__/services/optionLinksGuard.test.ts
--
-- ROLLBACK: #570 본문(20260928120000_570_option_links_qty_follows_main.sql)의
--           CREATE OR REPLACE FUNCTION upsert_product_option_links 를 그대로 다시 실행.

CREATE OR REPLACE FUNCTION upsert_product_option_links(p_product_id UUID, p_option_links JSONB)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_ids   UUID[];
  added_ids UUID[];
BEGIN
  SELECT ARRAY(
    SELECT (el->>'option_product_id')::UUID
    FROM jsonb_array_elements(p_option_links) AS el
    WHERE el->>'option_product_id' IS NOT NULL
  ) INTO new_ids;

  -- 검증 1: 자기 자신 금지 (기존 연결 여부와 무관)
  IF p_product_id = ANY(new_ids) THEN
    RAISE EXCEPTION 'OPTION_SELF_REF';
  END IF;

  -- 이번 저장에서 새로 추가되는 항목만 아래 검증 대상
  SELECT ARRAY(
    SELECT x FROM unnest(new_ids) AS x
    WHERE NOT EXISTS (
      SELECT 1 FROM product_option_links pol
      WHERE pol.product_id = p_product_id
        AND pol.option_product_id = x
        AND pol.deleted_at IS NULL
    )
  ) INTO added_ids;

  IF CARDINALITY(added_ids) > 0 THEN
    -- 검증 2: 재고 단위(자식) 상품 금지
    IF EXISTS (
      SELECT 1 FROM products
      WHERE id = ANY(added_ids) AND parent_product_id IS NOT NULL AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'OPTION_CHILD_PRODUCT';
    END IF;

    -- 검증 3: 삭제된 상품 금지
    IF EXISTS (
      SELECT 1 FROM products WHERE id = ANY(added_ids) AND deleted_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'OPTION_DELETED_PRODUCT';
    END IF;

    -- 검증 4: 같은 상품의 결합 구성품 금지
    IF EXISTS (
      SELECT 1 FROM product_bundle_links pbl
      WHERE pbl.product_id = p_product_id
        AND pbl.bundle_product_id = ANY(added_ids)
        AND pbl.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'OPTION_BUNDLE_OVERLAP';
    END IF;
  END IF;

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
