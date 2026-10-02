-- Migration 619: cms_add_reservation_product_unit — 추가 상품에 원본의 대여 일정 정보 복사 + 영향받은 기존 예약 복구 (2026-10-02)
--
-- 실사고: 조이서 주문 45 — CMS 상세 패널 "+ 추가"로 SONY PXW-Z90을 추가한 예약 237이 수령/반납 시간·지점을 갖지 못했다.
-- compute_reservation_line_amount는 (end_date-start_date)*1440 + (반납시각-수령시각)분으로 시간 블록을 계산하므로
-- 같은 날 대여에서 시간이 비면 0분 → 요금 0원이 된다. 그 결과 order_items.line_total=0, 주문 결제금액이
-- (10,000 - 쿠폰 10,000 = 0원)으로 표시됐다. 원인은 RPC의 INSERT가 날짜·방식·기간유형만 복사하고
-- pickup_time/return_time/pickup_point_id/return_point_id/휴무일 연장일/주소·요청사항을 빠뜨린 것.
--
-- 변경:
--   ① cms_add_reservation_product_unit: 원본 예약의 일정·장소 정보 10개 컬럼을 새 예약에 복사
--      (pickup_time, return_time, pickup_point_id, return_point_id, pickup_holiday_extra_days, return_holiday_extra_days,
--       pickup_address_road, pickup_address_detail, pickup_request_note, return_request_note).
--      예약 고유값(예약코드·운송장·결제확인 시각·락커 비밀번호·Dhero·취소 시각 등)은 복사하지 않는다. 그 외 로직은 기존과 동일.
--      CREATE OR REPLACE는 기존 권한(service_role 전용, Migration 430)을 그대로 보존한다.
--   ② 데이터 복구(일회성): 이미 같은 증상으로 만들어진 예약 — 신청대기(hold)·미결제·구매 유형 아님·수령/반납 시간이 모두 비어 있고
--      같은 주문에 시간이 있는 형제가 있는 예약 — 에 형제(가장 작은 id)의 일정·장소 정보를 채우고, 그 예약의 order_items 금액을
--      요금 함수로 다시 계산한 뒤 주문 합계를 재동기화한다. (운영 조회 결과 해당 예약은 237 한 건, Stage는 0건.)
--      채울 값이 이미 있으면 덮어쓰지 않는다(COALESCE).

CREATE OR REPLACE FUNCTION public.cms_add_reservation_product_unit(p_reservation_id bigint, p_product_id uuid)
 RETURNS TABLE(success boolean, new_reservation_id bigint, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status        TEXT;
  v_paid_at       TIMESTAMPTZ;
  v_user_id       UUID;
  v_start_date    DATE;
  v_end_date      DATE;
  v_pickup_method TEXT;
  v_return_method TEXT;
  v_duration_type TEXT;
  v_pickup_time   TEXT;
  v_return_time   TEXT;
  v_pickup_point  UUID;
  v_return_point  UUID;
  v_pickup_extra  INTEGER;
  v_return_extra  INTEGER;
  v_pickup_road   TEXT;
  v_pickup_detail TEXT;
  v_pickup_note   TEXT;
  v_return_note   TEXT;
  v_unit_id       UUID;
  v_new_res_id    BIGINT;
  v_order_id      BIGINT;
  v_unit_price    NUMERIC;
  v_line_total    NUMERIC;
BEGIN
  SELECT status, payment_confirmed_at, user_id, start_date, end_date,
         pickup_method, return_method, duration_type,
         pickup_time, return_time, pickup_point_id, return_point_id,
         pickup_holiday_extra_days, return_holiday_extra_days,
         pickup_address_road, pickup_address_detail,
         pickup_request_note, return_request_note
  INTO   v_status, v_paid_at, v_user_id, v_start_date, v_end_date,
         v_pickup_method, v_return_method, v_duration_type,
         v_pickup_time, v_return_time, v_pickup_point, v_return_point,
         v_pickup_extra, v_return_extra,
         v_pickup_road, v_pickup_detail,
         v_pickup_note, v_return_note
  FROM   rental_reservations
  WHERE  id = p_reservation_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '예약을 찾을 수 없습니다.'; RETURN;
  END IF;
  IF v_status <> 'hold' OR v_paid_at IS NOT NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '이미 계약 또는 결제가 진행되어 상품 구성을 수정할 수 없습니다.'; RETURN;
  END IF;
  IF v_start_date IS NULL OR v_end_date IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '원본 예약에 대여 기간 정보가 없습니다.'; RETURN;
  END IF;

  SELECT p.id INTO v_unit_id
  FROM   products p
  WHERE  p.parent_product_id = p_product_id
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
  ORDER  BY p.created_at
  LIMIT  1
  FOR UPDATE SKIP LOCKED;

  IF v_unit_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '해당 기간에 예약 가능한 재고가 없습니다.'; RETURN;
  END IF;

  INSERT INTO rental_reservations (
    user_id, product_id, status,
    start_date, end_date,
    pickup_method, return_method, duration_type,
    pickup_time, return_time, pickup_point_id, return_point_id,
    pickup_holiday_extra_days, return_holiday_extra_days,
    pickup_address_road, pickup_address_detail,
    pickup_request_note, return_request_note
  )
  VALUES (
    v_user_id, v_unit_id, 'hold',
    v_start_date, v_end_date,
    v_pickup_method, v_return_method, v_duration_type,
    v_pickup_time, v_return_time, v_pickup_point, v_return_point,
    v_pickup_extra, v_return_extra,
    v_pickup_road, v_pickup_detail,
    v_pickup_note, v_return_note
  )
  RETURNING id INTO v_new_res_id;

  SELECT oi.order_id INTO v_order_id
  FROM   order_items oi
  WHERE  oi.reservation_id = p_reservation_id
  LIMIT  1;

  IF v_order_id IS NOT NULL THEN
    SELECT rental_fee, rental_fee + options_fee
    INTO   v_unit_price, v_line_total
    FROM   compute_reservation_line_amount(v_new_res_id);

    INSERT INTO order_items (order_id, reservation_id, product_id, quantity, unit_price, line_total)
    VALUES (v_order_id, v_new_res_id, v_unit_id, 1,
            COALESCE(v_unit_price, 0), COALESCE(v_line_total, 0));

    PERFORM sync_order_after_composition_change(v_order_id);
  END IF;

  RETURN QUERY SELECT true, v_new_res_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, NULL::BIGINT, SQLERRM;
END;
$function$;

-- ② 데이터 복구(일회성) — 이미 같은 증상으로 만들어진 신청대기 예약의 일정·장소 정보 채움 + 금액 재계산 + 주문 합계 재동기화
DO $repair$
DECLARE
  t           RECORD;
  v_fee       NUMERIC;
  v_opt       NUMERIC;
  v_fixed     INTEGER := 0;
  v_orders    BIGINT[] := '{}';
  v_oid       BIGINT;
BEGIN
  FOR t IN
    SELECT r.id AS rid, oi.order_id,
           (SELECT s.id
              FROM order_items o2 JOIN rental_reservations s ON s.id = o2.reservation_id
             WHERE o2.order_id = oi.order_id AND s.id <> r.id AND s.pickup_time IS NOT NULL
             ORDER BY s.id LIMIT 1) AS src_id
    FROM rental_reservations r
    JOIN order_items oi ON oi.reservation_id = r.id
    WHERE r.status = 'hold'
      AND r.payment_confirmed_at IS NULL
      AND r.duration_type IS DISTINCT FROM 'purchase'
      AND r.pickup_time IS NULL
      AND r.return_time IS NULL
  LOOP
    CONTINUE WHEN t.src_id IS NULL;

    UPDATE rental_reservations tgt
    SET pickup_time               = COALESCE(tgt.pickup_time, src.pickup_time),
        return_time               = COALESCE(tgt.return_time, src.return_time),
        pickup_point_id           = COALESCE(tgt.pickup_point_id, src.pickup_point_id),
        return_point_id           = COALESCE(tgt.return_point_id, src.return_point_id),
        pickup_holiday_extra_days = COALESCE(tgt.pickup_holiday_extra_days, src.pickup_holiday_extra_days),
        return_holiday_extra_days = COALESCE(tgt.return_holiday_extra_days, src.return_holiday_extra_days),
        pickup_address_road       = COALESCE(tgt.pickup_address_road, src.pickup_address_road),
        pickup_address_detail     = COALESCE(tgt.pickup_address_detail, src.pickup_address_detail),
        pickup_request_note       = COALESCE(tgt.pickup_request_note, src.pickup_request_note),
        return_request_note       = COALESCE(tgt.return_request_note, src.return_request_note)
    FROM rental_reservations src
    WHERE tgt.id = t.rid AND src.id = t.src_id;

    SELECT cl.rental_fee, cl.options_fee INTO v_fee, v_opt
    FROM compute_reservation_line_amount(t.rid) cl;

    UPDATE order_items
    SET unit_price = COALESCE(v_fee, 0),
        line_total = COALESCE(v_fee, 0) + COALESCE(v_opt, 0)
    WHERE reservation_id = t.rid;

    v_fixed := v_fixed + 1;
    IF NOT (t.order_id = ANY(v_orders)) THEN
      v_orders := array_append(v_orders, t.order_id);
    END IF;
  END LOOP;

  FOREACH v_oid IN ARRAY v_orders LOOP
    PERFORM sync_order_after_composition_change(v_oid);
  END LOOP;

  RAISE NOTICE 'Migration 619 repair: % reservation(s) fixed, % order(s) re-synced', v_fixed, COALESCE(array_length(v_orders, 1), 0);
END
$repair$;

-- ============================================================
-- ROLLBACK: cms_add_reservation_product_unit을 Migration 430 이전 정의(저장소 20260903010000_428_*.sql)로 CREATE OR REPLACE.
-- 데이터 복구분(예약 237 등)은 일정 컬럼이 NULL이던 이전 상태로 되돌릴 수 있으나 되돌리면 금액이 다시 0원이 되므로 권장하지 않음.
-- ============================================================
