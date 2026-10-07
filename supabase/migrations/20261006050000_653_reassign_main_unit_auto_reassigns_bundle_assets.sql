-- Migration #653: 패키지 본체 '상품 코드 재배정' 실행 시 결합상품별 가용 재고도 자동 재배정
-- 2026-10-06 | Stephen 확정("부모상품 자동 배정 + 결합상품 직접 재배정 공존") | TDD: src/__tests__/services/bundleAutoReassignOnMainReassign.test.ts
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh)
--
-- 직전 정의: 20260908090000_465_cms_reassign_reservation_product_code_allow_tracking.sql (Stage 현행 정의와 동일 확인)
-- 변경 범위: 본체 교체가 성공한 직후, 이 예약의 결합 배정(reservation_bundle_assets) 각 줄마다
--   같은 결합상품의 "다른" 가용 재고 중 가장 낮은 품번으로 자동 교체한다.
--   · 가용 판정은 #652의 private.bundle_asset_is_free와 동일(assign_bundle_assets 규칙)
--   · 다른 가용 재고가 없으면 현재 배정을 유지한다(본체 교체는 실패시키지 않는다 — 결합상품 재고가 1개뿐인 경우 등)
--   · 본체 교체와 같은 트랜잭션 — 중간 오류 시 본체 교체까지 함께 롤백(EXCEPTION 블록)
--   · 결합 배정이 없는 예약(일반 상품·레거시)은 기존 동작과 완전히 동일
-- 시그니처·반환형·권한은 무변경. 결합상품 줄의 직접 재배정(#652 cms_reassign_bundle_asset)은 그대로 공존한다.
-- ⚠️ 관리자가 결합상품을 직접 재배정해 둔 예약에서 본체를 다시 재배정하면 결합 배정도 자동 재선택된다(정책, Stephen 확정).
--
-- ROLLBACK: #465 파일의 CREATE OR REPLACE FUNCTION 본문으로 되돌린다.

CREATE OR REPLACE FUNCTION public.cms_reassign_reservation_product_code(
  p_reservation_id BIGINT,
  p_new_unit_id    UUID
)
RETURNS TABLE(success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status           TEXT;
  v_current_unit_id  UUID;
  v_start_date       DATE;
  v_end_date         DATE;
  v_current_parent   UUID;
  v_new_parent       UUID;
  v_available        UUID;
  v_row              RECORD;
  v_cand             UUID;
  v_pick             UUID;
  v_sale             BOOLEAN;
BEGIN
  SELECT status, product_id, start_date, end_date
  INTO   v_status, v_current_unit_id, v_start_date, v_end_date
  FROM   rental_reservations
  WHERE  id = p_reservation_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN QUERY SELECT false, '예약을 찾을 수 없습니다.'; RETURN;
  END IF;

  IF v_status = 'expired' THEN
    RETURN QUERY SELECT false, '예약이 만료되어 재고를 재배정할 수 없습니다.'; RETURN;
  END IF;
  IF v_status = 'cancelled' THEN
    RETURN QUERY SELECT false, '취소된 예약은 재고를 재배정할 수 없습니다.'; RETURN;
  END IF;
  IF NOT (v_status = 'hold' OR v_status = 'confirmed') THEN
    RETURN QUERY SELECT false, '반출 이후(대여 진행 중) 예약은 재고를 재배정할 수 없습니다.'; RETURN;
  END IF;

  IF v_start_date IS NULL OR v_end_date IS NULL THEN
    RETURN QUERY SELECT false, '예약 기간 정보가 없어 재배정할 수 없습니다.'; RETURN;
  END IF;

  SELECT parent_product_id INTO v_current_parent FROM products WHERE id = v_current_unit_id;
  SELECT parent_product_id INTO v_new_parent     FROM products WHERE id = p_new_unit_id;

  IF v_current_parent IS NULL OR v_new_parent IS NULL THEN
    RETURN QUERY SELECT false, '상품 정보를 확인할 수 없습니다.'; RETURN;
  END IF;

  IF v_current_parent <> v_new_parent THEN
    RETURN QUERY SELECT false, '같은 상품의 다른 재고단위로만 재배정할 수 있습니다.'; RETURN;
  END IF;

  SELECT p.id INTO v_available
  FROM   products p
  WHERE  p.id = p_new_unit_id
    AND  p.deleted_at IS NULL
    AND  p.is_active = true
    AND  NOT EXISTS (
      SELECT 1
      FROM   rental_reservations rr
      WHERE  rr.product_id = p.id
        AND  rr.status NOT IN ('cancelled', 'returned', 'completed', 'expired')
        AND  daterange(rr.start_date, rr.end_date, '[]') &&
             daterange(v_start_date, v_end_date, '[]')
    )
  FOR UPDATE SKIP LOCKED;

  IF v_available IS NULL THEN
    RETURN QUERY SELECT false, '선택한 재고가 이미 다른 예약에 배정되었습니다.'; RETURN;
  END IF;

  UPDATE rental_reservations
  SET    product_id = p_new_unit_id
  WHERE  id = p_reservation_id;

  UPDATE order_items
  SET    product_id = p_new_unit_id
  WHERE  reservation_id = p_reservation_id;

  -- 결합상품별 가용 재고 자동 재배정(결합 배정이 없으면 이 루프는 건너뜀)
  FOR v_row IN
    SELECT a.bundle_product_id, a.asset_product_id
      FROM reservation_bundle_assets a
     WHERE a.reservation_id = p_reservation_id
     ORDER BY a.id
     FOR UPDATE
  LOOP
    v_pick := NULL;
    SELECT COALESCE(bp.sale_only, false) INTO v_sale FROM products bp WHERE bp.id = v_row.bundle_product_id;

    -- 후보 행을 먼저 잠근 뒤(SKIP LOCKED) 별도 문장에서 점유를 재확인 — assign_bundle_assets·#652와 같은 순서
    FOR v_cand IN
      SELECT c.id
        FROM products c
       WHERE c.parent_product_id = v_row.bundle_product_id
         AND c.deleted_at IS NULL
         AND c.is_active = true
         AND c.id <> v_row.asset_product_id
       ORDER BY c.product_code NULLS LAST, c.created_at, c.id
       FOR UPDATE SKIP LOCKED
    LOOP
      IF private.bundle_asset_is_free(v_cand, COALESCE(v_sale, false), v_start_date, v_end_date, p_reservation_id) THEN
        v_pick := v_cand;
        EXIT;
      END IF;
    END LOOP;

    IF v_pick IS NOT NULL THEN
      UPDATE reservation_bundle_assets
         SET asset_product_id = v_pick
       WHERE reservation_id = p_reservation_id
         AND bundle_product_id = v_row.bundle_product_id;
    END IF;
  END LOOP;

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.cms_reassign_reservation_product_code(BIGINT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_reassign_reservation_product_code(BIGINT, UUID) TO service_role;
