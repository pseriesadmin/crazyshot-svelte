-- 445_compute_reservation_line_amount_delivery_type.sql
--
-- 배경(2026-09-04, Stephen 요청 — 수령→반납 방식 조합별 금액 검증 중 발견):
-- 클라이언트(cart/+page.svelte)의 대여요금 "1day 강제청구" 판정을 is_bulk_delivery("요청 A"
-- 반납강제고정 전용)에서 is_delivery_type으로 분리(itemRentalFee/itemOptionsAmount/
-- otTotalMinutes)했는데, 실제 결제금액을 계산하는 서버 정본 RPC는 여전히 is_bulk_delivery
-- 기준으로 남아있어 화면 미리보기와 실제 청구액이 어긋나는 문제가 있었다.
--
-- 조건 정리(수령→반납 조합별):
--   ① 배송+배송, ② 배송+배송아님 → 수령이 배송이면 항상 1day(N일) 블록 청구
--   ③ 배송아님+배송 → set_reservation_shipment_method(Migration #443)가 이미 선택 자체를 차단
--   ④ 배송아님+배송아님 → 12h/24h 블록 올림 산식 그대로
--
-- 연동 로직 전수 검토 완료(2026-09-04): is_bulk_delivery를 참조하는 DB 함수는 전체에서
-- compute_reservation_line_amount·toggle_rental_method_bulk_delivery 단 2개뿐이며, 후자는
-- CMS 토글 RPC 자체라 요금과 무관. calculate_cart_total·create_reservation_order는 자체
-- 판정변수 없이 이 함수를 그대로 위임 호출하고, 결제(pay-mock)·Toss 웹훅 정산
-- (process_pending_toss_webhooks)은 이 시점에 이미 확정된 금액을 조회만 할 뿐 재계산하지
-- 않음 — 분기된 중복 계산 경로 없이 이 함수 하나만 수정하면 전체 흐름에 일관되게 반영됨.
--
-- 변경 내용: v_delivery_locked 판정 조건의 컬럼명 한 곳만 교체(rmo.is_bulk_delivery →
-- rmo.is_delivery_type). 그 외 로직(판매전용 분기·12시간 블록 산식·옵션요금 계산·보증금)은
-- 완전히 동일.

CREATE OR REPLACE FUNCTION public.compute_reservation_line_amount(p_reservation_id bigint)
 RETURNS TABLE(rental_fee numeric, options_fee numeric, deposit numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r               RECORD;
  v_is_sale       BOOLEAN;
  v_sale_price    NUMERIC;
  v_daily         NUMERIC;
  v_half          NUMERIC;
  v_dep           NUMERIC;
  v_p_hour        INT;
  v_p_min         INT;
  v_r_hour        INT;
  v_r_min         INT;
  v_total_minutes INT;
  v_blocks        INT;
  v_days          INT;
  v_has_half      BOOLEAN;
  v_fee           NUMERIC;
  v_options_fee   NUMERIC;
  v_delivery_locked BOOLEAN;
BEGIN
  SELECT rr.product_id, rr.start_date, rr.end_date, rr.pickup_time, rr.return_time, rr.pickup_method
  INTO r
  FROM rental_reservations rr
  WHERE rr.id = p_reservation_id;

  IF r.product_id IS NULL OR r.start_date IS NULL OR r.end_date IS NULL THEN
    RETURN QUERY SELECT 0::NUMERIC, 0::NUMERIC, 0::NUMERIC;
    RETURN;
  END IF;

  SELECT COALESCE(sale_only, false), sale_price INTO v_is_sale, v_sale_price
  FROM products WHERE id = r.product_id;

  -- 판매전용 상품: 날짜×요금 계산을 건너뛰고 판매금액을 그대로 사용, 옵션도 flat 유지,
  -- 보증금은 없음 (#416 그대로 — 대여기간 개념이 없는 경로이므로 12시간 블록 산식 미적용)
  IF v_is_sale THEN
    SELECT COALESCE(SUM(ro.unit_price * ro.qty), 0)
    INTO v_options_fee
    FROM reservation_options ro
    WHERE ro.reservation_id = p_reservation_id;

    RETURN QUERY SELECT COALESCE(v_sale_price, 0)::NUMERIC, v_options_fee, 0::NUMERIC;
    RETURN;
  END IF;

  SELECT MAX(price) FILTER (WHERE duration_type = '24h'),
         MAX(price) FILTER (WHERE duration_type = '12h'),
         MAX(deposit_amount) FILTER (WHERE duration_type = '24h')
  INTO v_daily, v_half, v_dep
  FROM price_rules
  WHERE product_id = r.product_id;

  v_daily := COALESCE(v_daily, 0);
  v_half  := COALESCE(v_half, 0);
  v_dep   := COALESCE(v_dep, 0);

  v_p_hour := COALESCE(NULLIF(split_part(r.pickup_time, ':', 1), '')::INT, 0);
  v_p_min  := COALESCE(NULLIF(split_part(r.pickup_time, ':', 2), '')::INT, 0);
  v_r_hour := COALESCE(NULLIF(split_part(r.return_time, ':', 1), '')::INT, 0);
  v_r_min  := COALESCE(NULLIF(split_part(r.return_time, ':', 2), '')::INT, 0);

  -- 배송(왕복 배송료) 잠금 판정(2026-09-04 — is_delivery_type 기준으로 교체) — "요청 A"
  -- (is_bulk_delivery, 반납강제고정)와 무관하게 수령(pickup_method) 하나만으로 판정한다.
  -- 반납방식이 배송인데 수령이 배송이 아닌 조합은 set_reservation_shipment_method(#443)가
  -- 이미 원천 차단하므로 여기서 반납방식을 별도로 볼 필요가 없다.
  SELECT EXISTS(
    SELECT 1 FROM rental_method_options rmo
    WHERE rmo.method_key = r.pickup_method
      AND rmo.is_delivery_type = true
      AND rmo.is_active = true
      AND rmo.deleted_at IS NULL
  ) INTO v_delivery_locked;

  IF v_delivery_locked THEN
    -- "대여일 00:00 ~ 반납일 24:00" — 수령일·반납일 두 날짜 모두 온전한 하루로 청구(#439).
    v_days     := GREATEST((r.end_date - r.start_date), 0) + 1;
    v_has_half := false;
    v_fee      := v_days * v_daily;
  ELSE
    -- 당일/다일 통합 — 총 대여시간(분)을 12시간(720분) 블록으로 올림 처리 (#435와 동일 산식)
    v_total_minutes := (r.end_date - r.start_date) * 1440
                        + (v_r_hour * 60 + v_r_min) - (v_p_hour * 60 + v_p_min);
    IF v_total_minutes <= 0 THEN
      v_days     := 0;
      v_has_half := false;
      v_fee      := 0;
    ELSE
      v_blocks   := CEIL(v_total_minutes / 720.0)::INT;
      v_days     := v_blocks / 2;              -- INT/INT는 양수에서 floor와 동일
      v_has_half := (v_blocks % 2 = 1);
      v_fee := v_days * v_daily + (CASE WHEN v_has_half THEN v_half ELSE 0 END);
    END IF;
  END IF;

  -- 옵션상품도 본상품과 동일한 블록(v_days/v_has_half — 배송 잠금이면 포함 일수)을 적용하되,
  -- 12h가는 그 옵션 상품 자체의 price_rules에서 독립적으로 조회한다(#437 그대로).
  -- 12h price_rule이 없는 옵션은 블록 가산 없이 flat(unit_price × qty)으로 폴백.
  SELECT COALESCE(SUM(
    CASE
      WHEN opt_price.price_12h IS NOT NULL THEN
        ro.qty * (v_days * ro.unit_price + CASE WHEN v_has_half THEN opt_price.price_12h ELSE 0 END)
      ELSE
        ro.qty * ro.unit_price
    END
  ), 0)
  INTO v_options_fee
  FROM reservation_options ro
  LEFT JOIN LATERAL (
    SELECT MAX(pr.price) AS price_12h
    FROM price_rules pr
    WHERE pr.product_id = ro.option_product_id
      AND pr.duration_type = '12h'
      AND pr.is_active = true
      AND pr.deleted_at IS NULL
  ) opt_price ON true
  WHERE ro.reservation_id = p_reservation_id;

  RETURN QUERY SELECT v_fee, v_options_fee, v_dep;
END;
$function$;
