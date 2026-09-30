-- Migration #601: 결합상품 양방향 중첩 차단 (Stephen 지시, 2026-09-30)
--
-- 배경: #572는 검증 4(BUNDLE_NESTING_FORBIDDEN — "추가하려는 부품이 이미 패키지인가")만 남겨
-- "패키지 안의 패키지"를 차단한다고 서술했지만, 이 검증은 한 방향만 본다. A→B를 먼저 등록한 뒤
-- B→C를 등록하면(B가 이미 A의 부품인데 B가 자기 목록을 갖게 됨) 통과해 중첩이 만들어진다
-- (Stage 실측: 활성 링크 중 부품이 자기도 패키지인 쌍 존재 / Production 0건).
-- 재고 배정(assign_bundle_assets)·가용재고는 1단계만 펼치므로 이 경우 C가 점유·계산에서 빠져
-- 재고 과다표시와 이중예약 여지가 생긴다.
--
-- 변경: 검증 7 추가 — 이 상품(p_product_id)이 이미 다른(삭제되지 않은) 패키지의 부품으로 쓰이고
-- 있으면 자신의 결합상품 목록을 저장할 수 없다(BUNDLE_IS_PART_OF_PACKAGE). 빈 목록 저장(정리)은
-- 항상 허용. 검증 1~4와 나머지 본문은 #572와 동일(무변경).
-- ⚠️ 이미 중첩 상태인 기존 패키지(Stage 테스트 데이터)는 목록을 비우면 정리할 수 있고, 목록을
--    그대로 다시 저장하려 하면 이 검증에 걸린다(Production은 해당 없음 — 0건).
--
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh)
--
-- ROLLBACK: #572 본문(20260928140000_572_bundle_links_relax_nesting_and_overlap.sql)의
--           CREATE OR REPLACE FUNCTION upsert_product_bundle_links 를 그대로 다시 실행.

CREATE OR REPLACE FUNCTION upsert_product_bundle_links(
  p_product_id   UUID,
  p_bundle_links JSONB
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_ids UUID[];
BEGIN
  SELECT ARRAY(
    SELECT (el->>'bundle_product_id')::UUID
    FROM jsonb_array_elements(p_bundle_links) AS el
    WHERE el->>'bundle_product_id' IS NOT NULL
  ) INTO new_ids;

  -- 검증 1: 자기 자신 참조 금지
  IF p_product_id = ANY(new_ids) THEN
    RAISE EXCEPTION 'BUNDLE_SELF_REF';
  END IF;

  -- 검증 2: 자식(재고) 상품 등록 금지
  IF EXISTS (
    SELECT 1 FROM products
    WHERE id = ANY(new_ids)
      AND parent_product_id IS NOT NULL
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'BUNDLE_CHILD_PRODUCT';
  END IF;

  -- 검증 3: 삭제된 상품 등록 금지
  IF CARDINALITY(new_ids) > 0 AND EXISTS (
    SELECT 1 FROM products
    WHERE id = ANY(new_ids)
      AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'BUNDLE_DELETED_PRODUCT';
  END IF;

  -- 검증 4: 추가하려는 부품이 이미 자체 결합목록을 가진 패키지면 금지
  IF CARDINALITY(new_ids) > 0 AND EXISTS (
    SELECT 1 FROM product_bundle_links
    WHERE product_id = ANY(new_ids)
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'BUNDLE_NESTING_FORBIDDEN';
  END IF;

  -- 검증 7(#601, 신규): 이 상품이 이미 삭제되지 않은 다른 패키지의 부품이면
  --                     자신의 결합상품 목록을 만들 수 없다(반대 방향 중첩 차단)
  IF CARDINALITY(new_ids) > 0 AND EXISTS (
    SELECT 1
    FROM product_bundle_links l
    JOIN products pk ON pk.id = l.product_id AND pk.deleted_at IS NULL
    WHERE l.bundle_product_id = p_product_id
      AND l.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'BUNDLE_IS_PART_OF_PACKAGE';
  END IF;

  -- 신규 목록에 없는 기존 행 하드딜리트
  DELETE FROM product_bundle_links
  WHERE product_id = p_product_id
    AND (CARDINALITY(new_ids) = 0 OR bundle_product_id <> ALL(new_ids));

  IF CARDINALITY(new_ids) > 0 THEN
    INSERT INTO product_bundle_links (product_id, bundle_product_id, display_order)
    SELECT
      p_product_id,
      (el->>'bundle_product_id')::UUID,
      COALESCE((el->>'display_order')::SMALLINT, 0)
    FROM jsonb_array_elements(p_bundle_links) AS el
    WHERE el->>'bundle_product_id' IS NOT NULL
    ON CONFLICT (product_id, bundle_product_id) DO UPDATE SET
      deleted_at    = NULL,
      display_order = EXCLUDED.display_order,
      updated_at    = NOW();
  END IF;
END;
$$;

-- 함수 권한은 CREATE OR REPLACE로 기존 GRANT가 그대로 보존됨(service_role 전용, #544)
