-- Migration 371: find_matching_cart_reservation_group RPC
-- 장바구니 동일 부모상품 중복담기 → 하나로 병합 (2026-08-28, Stephen GATE B 승인)
--
-- 상품상세 "담기" 시, 이 사용자가 이미 이 부모상품을 카트(hold/draft)에 담아뒀는지 조회한다.
-- find_or_create_general_chat_session(Migration 282)과 동일한 "자연키로 조회" 스타일 —
-- 여러 호출부가 각자 조회 로직을 재구현하다 드리프트하는 것을 막기 위해 단일 RPC로 제공한다.
--
-- 병합 조건(Stephen 확정):
--   hold  — p_start_date/p_end_date가 둘 다 주어지면, 부모상품(product.parent_product_id)+
--           수령일+반납일이 완전히 같은 hold 예약만 매치(날짜 다르면 별도 그룹으로 유지).
--   draft — 둘 다 NULL이면, 부모상품만 같으면 매치(draft는 아직 날짜가 없음).
--
-- 자식 상품이 하드 삭제/비활성화된 경우 INNER JOIN이 자동으로 그 예약을 매치 대상에서
-- 제외한다(크래시 없이 "그룹 없음"으로 안전 저하).

CREATE OR REPLACE FUNCTION public.find_matching_cart_reservation_group(
  p_product_id UUID,        -- 호출측이 resolveParentProductId()로 미리 해석한 "부모" id
  p_start_date DATE DEFAULT NULL,
  p_end_date   DATE DEFAULT NULL
)
RETURNS TABLE(
  canonical_reservation_id BIGINT,
  member_reservation_ids   BIGINT[],   -- id 오름차순(=생성순), [0]이 canonical
  existing_options         JSONB       -- set_reservation_options가 받는 것과 동일 shape
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_ids BIGINT[];
  v_canonical BIGINT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN; -- 로그인 세션 없음 — 호출측은 "기존 그룹 없음"으로 처리(신규 생성 경로로 진행)
  END IF;

  IF p_start_date IS NOT NULL AND p_end_date IS NOT NULL THEN
    -- hold 경로: rental_reservations.product_id는 배정된 자식(재고단위) UUID이므로
    -- products를 조인해 부모 id로 판정한다.
    SELECT ARRAY_AGG(rr.id ORDER BY rr.id)
    INTO v_ids
    FROM rental_reservations rr
    JOIN products p ON p.id = rr.product_id AND p.deleted_at IS NULL
    WHERE rr.user_id = v_user_id
      AND rr.status = 'hold'
      AND rr.start_date = p_start_date
      AND rr.end_date = p_end_date
      AND p.parent_product_id = p_product_id;
  ELSE
    -- draft 경로: product_id가 이미 부모 UUID 그대로 저장돼 있음(create_draft_reservation).
    SELECT ARRAY_AGG(rr.id ORDER BY rr.id)
    INTO v_ids
    FROM rental_reservations rr
    WHERE rr.user_id = v_user_id
      AND rr.status = 'draft'
      AND rr.product_id = p_product_id;
  END IF;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN; -- 매치 없음
  END IF;

  v_canonical := v_ids[1];

  RETURN QUERY
  SELECT
    v_canonical,
    v_ids,
    (
      SELECT jsonb_agg(jsonb_build_object(
        'option_product_id', ro.option_product_id,
        'option_name',       ro.option_name,
        'qty',               ro.qty,
        'unit_price',        ro.unit_price
      ))
      FROM reservation_options ro
      WHERE ro.reservation_id = v_canonical
    );
END;
$$;

REVOKE ALL ON FUNCTION public.find_matching_cart_reservation_group(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_matching_cart_reservation_group(UUID, DATE, DATE) TO authenticated;
