-- Migration #465: cms_reassign_reservation_product_code — 운송장 등록 여부와 무관하게
-- '계약완료(confirmed)' 상태 전체에서 재고(실물 재고단위) 재배정을 허용하도록 확장.
--
-- 배경(2026-09-08, Stephen 확정): 기존에는 confirmed 상태라도 운송장(택배 송장번호)이
-- 이미 등록되면 재배정이 차단됐다. 그러나 confirmed는 실물이 아직 창고에서 반출되기
-- 전 단계이므로(반출은 shipped 전이 시점에 발생) 운송장 "등록"만으로는 QR 스티커가 실제
-- 고객에게 전달된 상태가 아니다 — 운송장 번호는 반출 전에 미리 입력해두는 경우가 흔해
-- 이 조건이 불필요하게 재배정을 막고 있었다. shipped/in_use 이후(실물 반출 완료) 상태는
-- 여전히 차단 — 이 단계부터는 QR 스티커가 이미 실물과 함께 고객에게 전달됐을 수 있어
-- DB만 바꾸면 반납 스캔 시 실물-DB 불일치가 발생할 위험이 있다(products.md §2-1 QR=실물
-- 원칙과 충돌).
--
-- 원본 정의: 20260903010000_428_cms_reservation_product_edit_rpcs.sql
-- 직전 정의: 20260903020000_429_cms_reservation_edit_rpcs_error_messages.sql (v_tracking 조건 포함)

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

  RETURN QUERY SELECT true, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.cms_reassign_reservation_product_code(BIGINT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_reassign_reservation_product_code(BIGINT, UUID) TO service_role;
