-- Migration #572: 결합상품 등록 제약 완화 (Stephen 지시, 2026-09-28)
--
-- 배경: Migration #544의 검증 5(BUNDLE_IS_NESTED)가 "이미 다른 패키지의 결합상품으로 쓰이고
-- 있는 상품은 그 자신에게 결합상품 목록을 만들 수 없다"를 막고 있었는데, 이게 실사용 중 혼선을
-- 유발했다 — 테스트용 부품 상품(Sony FX6-12·Manfrotto 055 등)이 이미 다른 패키지의 부품으로
-- 쓰이고 있다는 이유만으로, 그 상품 자신의 결합상품 탭이 통째로 막혀 있었다(2026-09-28 세션
-- 재현·보고). Stephen이 정책을 재정의했다:
--
--   1) 기본적으로 모든 상품은 결합상품을 추가할 수 있어야 한다.
--   2) 결합상품이 옵션상품과 겹쳐도 상관없다(같은 상품을 옵션으로도, 결합상품으로도 등록 가능).
--   3) 단, 같은 결합상품 목록 안에 동일 상품을 중복 등록하는 것은 막는다
--      (기존에도 UI(addBundleProduct 중복체크) + UNIQUE(product_id,bundle_product_id) +
--      ON CONFLICT UPSERT로 이미 안전하게 처리되고 있어 이번 마이그레이션에서 손댈 부분 없음).
--   4) 단, 이미 자기 자신의 결합상품 목록을 가진 상품("패키지")은 다른 패키지의 결합상품으로
--      추가할 수 없다(패키지 안에 패키지가 들어가는 이중 구조로 인한 혼선 방지) — 기존
--      검증 4(BUNDLE_NESTING_FORBIDDEN)를 그대로 유지.
--   5) 재고 단위(자식) 상품은 여전히 결합상품으로 추가할 수 없다(기존 검증 2 유지) — "단독
--      등록 상품만 결합상품으로 추가 가능"의 의미가 이것.
--
-- 변경: 검증 5(BUNDLE_IS_NESTED)와 검증 6(BUNDLE_OPTION_OVERLAP) 완전 제거.
--       검증 1(BUNDLE_SELF_REF)·2(BUNDLE_CHILD_PRODUCT)·3(BUNDLE_DELETED_PRODUCT)·
--       4(BUNDLE_NESTING_FORBIDDEN)는 무변경.
--
-- 안전성 확인(재고 배정 로직, Migration #547):
--   assign_bundle_assets()는 패키지의 "직계" 결합상품 목록만 1단계로 조회해 각각의 활성
--   자식(재고) 1개를 배정한다 — 결합상품으로 쓰인 상품이 동시에 자기 자신의 결합상품 목록을
--   갖고 있어도, 그 하위 목록까지 재귀적으로 펼치지 않는다(애초에 그렇게 설계돼 있지 않음).
--   따라서 "부품이면서 동시에 패키지"인 상품이 허용돼도 재고 배정 로직은 크래시하거나 이중
--   예약을 만들지 않는다 — 각 패키지의 hold는 항상 실물(자식) 단위로 독립적으로 겹침을
--   검사하기 때문. 검증 4(패키지를 결합상품으로 추가 금지)는 그대로 유지되므로, "결합상품
--   목록 안에 또 다른 결합상품 목록이 재귀적으로 연결되는" 진짜 위험 케이스는 여전히
--   원천 차단된다.
--
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh)
-- (Stephen 별도 확인 후 Production 적용)

CREATE OR REPLACE FUNCTION upsert_product_bundle_links(
  p_product_id   UUID,
  p_bundle_links JSONB
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_ids UUID[];
BEGIN
  -- 신규 목록의 bundle_product_id 배열 추출
  SELECT ARRAY(
    SELECT (el->>'bundle_product_id')::UUID
    FROM jsonb_array_elements(p_bundle_links) AS el
    WHERE el->>'bundle_product_id' IS NOT NULL
  ) INTO new_ids;

  -- 검증 1: 자기 자신 참조 금지
  IF p_product_id = ANY(new_ids) THEN
    RAISE EXCEPTION 'BUNDLE_SELF_REF';
  END IF;

  -- 검증 2: 자식(재고) 상품 등록 금지 — "단독 등록 상품만" 결합상품 가능
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

  -- 검증 4: 패키지 중첩 — 추가하려는 결합상품이 자체 결합목록을 가진 경우
  --         (bundle_product_id 자신이 이미 패키지인 경우) — 2026-09-28 정책에서도 유지
  --         ("이미 결합상품이 포함된 본 상품을 결합상품으로 추가 금지")
  IF CARDINALITY(new_ids) > 0 AND EXISTS (
    SELECT 1 FROM product_bundle_links
    WHERE product_id = ANY(new_ids)
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'BUNDLE_NESTING_FORBIDDEN';
  END IF;

  -- ⛔ 2026-09-28 제거(Migration #572): 검증 5(BUNDLE_IS_NESTED — "이 상품이 이미 다른
  -- 패키지의 결합상품이면 이 상품에 결합상품 등록 금지")와 검증 6(BUNDLE_OPTION_OVERLAP —
  -- "같은 상품의 옵션상품과 중복 금지")를 Stephen 지시로 완전히 제거했다. 이제 모든
  -- 단독 등록(비자식) 상품은 다른 패키지의 부품으로 쓰이고 있는지, 같은 상품이 옵션으로도
  -- 등록돼 있는지와 무관하게 자유롭게 결합상품을 가질 수 있다.

  -- 신규 목록에 없는 기존 행 하드딜리트 (soft-deleted 포함 전체 정리 — Migration 162 패턴)
  DELETE FROM product_bundle_links
  WHERE product_id = p_product_id
    AND (CARDINALITY(new_ids) = 0 OR bundle_product_id <> ALL(new_ids));

  -- 신규/변경 항목 UPSERT (ON CONFLICT: 기존 행 값 갱신) — 동일 상품 중복 등록은 여기서
  -- UNIQUE(product_id, bundle_product_id) + ON CONFLICT DO UPDATE로 자연히 멱등 처리된다.
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

-- 함수 권한은 CREATE OR REPLACE로 기존 GRANT가 그대로 보존됨(service_role 전용, Migration #544 참고)
