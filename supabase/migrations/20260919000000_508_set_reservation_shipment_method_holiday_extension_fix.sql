-- Migration 508: set_reservation_shipment_method — 휴무일 포함 배송 연장(rental-fee-policy.md §5)
-- 재계산 누락 결함 수정 (2026-09-19, Stephen 확인 후 CRITICAL 즉시수정)
--
-- 배경: create_hold_reservation(Migration 501)은 p_pickup_method/p_return_method가 NULL일 때
-- compute_holiday_extended_period도 당연히 연장 0일로 계산한다 — 그 자체는 정상 동작이다.
-- 문제는 그 이후: 실제 화면 흐름(상품상세 "예약하기")은 예약을 먼저 NULL 방식으로 만들고,
-- 그 다음 이 함수(set_reservation_shipment_method)로 실제 수령/반납 방식을 나중에 저장하는데,
-- 이 함수가 지금까지 pickup_method/return_method 컬럼만 갱신할 뿐 compute_holiday_extended_period를
-- 단 한 번도 다시 호출하지 않았다 — 그 결과 실제로 "크레이지샷배송"(유일한 is_courier_dependent
-- =true 방식)을 선택해도 pickup_holiday_extra_days/return_holiday_extra_days가 항상 0으로
-- 남아있었다. compute_reservation_line_amount(실제 결제금액 정본)는 이 두 컬럼을 그대로 읽어
-- holiday_extra_fee를 계산하므로, 실제로는 50% 연장요금이 단 한 번도 청구된 적이 없었다
-- (Stage DB 실데이터로 확인 — 크레이지샷배송을 쓴 최근 예약 15건 전부 두 컬럼이 0).
--
-- 더 심각한 부수 문제: create_hold_reservation의 재고잠금 조회(daterange 겹침 검사)도
-- v_effective_start/end(연장 반영 후 범위) 기준으로 동작하는데, 방식이 나중에 정해지는 이
-- 흐름에서는 애초에 start_date/end_date 자체가 연장 전(원래 요청) 날짜로 저장돼버려 그
-- 여분의 날짜만큼은 재고가 잠기지 않는 상태였다(같은 실물 재고가 그 여분 날짜에 다른 손님에게
-- 이중배정될 수 있는 위험 — Stephen 확인 후 이번 수정에 함께 포함).
--
-- 수정 방식: 이 함수 호출마다 "현재 저장된 값에서 이전 연장분을 되돌려 원래 요청 날짜를
-- 복원 → 새 방식 기준으로 compute_holiday_extended_period 재계산 → start_date/end_date/
-- pickup_holiday_extra_days/return_holiday_extra_days를 함께 갱신"한다. 방식이 실제로
-- 바뀌지 않은 호출(주소·요청사항만 수정 등)도 동일한 로직을 타지만 입력이 같으면 결과도
-- 같아 부작용 없음(멱등). 재계산 후 새 범위가 넓어졌다면, 같은 실물 재고(product_id)를 쓰는
-- 다른 활성 예약과 겹치는지 재확인해 겹치면 RAISE EXCEPTION으로 방식 변경 자체를 차단한다
-- (create_hold_reservation의 최초 재고잠금과 동일한 안전판 — 없으면 이 시점에 조용히
-- 이중배정이 발생할 수 있음).
--
-- 파라미터 목록 변경 없음(11-param 그대로) → DROP 없이 CREATE OR REPLACE만 사용해 기존
-- GRANT/REVOKE(Migration 477 REVOKE anon)를 그대로 보존한다(DROP+CREATE는 ACL을 초기화시켜
-- 재하드닝을 빠뜨리면 보안 회귀로 이어질 수 있음 — service-operations.md/security-auth.md에
-- 반복 기록된 원칙).

CREATE OR REPLACE FUNCTION public.set_reservation_shipment_method(
  p_reservation_id bigint,
  p_pickup_method text,
  p_return_method text DEFAULT NULL::text,
  p_pickup_time text DEFAULT NULL::text,
  p_return_time text DEFAULT NULL::text,
  p_pickup_address_road text DEFAULT NULL::text,
  p_pickup_address_detail text DEFAULT NULL::text,
  p_pickup_request_note text DEFAULT NULL::text,
  p_return_request_note text DEFAULT NULL::text,
  p_pickup_point_id uuid DEFAULT NULL::uuid,
  p_return_point_id uuid DEFAULT NULL::uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cur_start        DATE;
  v_cur_end          DATE;
  v_cur_pickup_extra INT;
  v_cur_return_extra INT;
  v_cur_return_method TEXT;
  v_product_id       UUID;
  v_base_start       DATE;
  v_base_end         DATE;
  v_new_return       TEXT;
  v_new_start        DATE;
  v_new_end          DATE;
  v_new_pickup_extra INT;
  v_new_return_extra INT;
  v_conflict         BOOLEAN;
BEGIN
  IF p_return_method IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM rental_method_options
       WHERE method_key = p_pickup_method AND is_delivery_type = true AND deleted_at IS NULL
     )
     AND EXISTS (
       SELECT 1 FROM rental_method_options
       WHERE method_key = p_return_method AND is_delivery_type = true AND deleted_at IS NULL
     )
  THEN
    RAISE EXCEPTION 'return_delivery_restricted: 반납 방식으로 배송을 선택할 수 없습니다.';
  END IF;

  SELECT start_date, end_date,
         COALESCE(pickup_holiday_extra_days, 0), COALESCE(return_holiday_extra_days, 0),
         return_method, product_id
    INTO v_cur_start, v_cur_end, v_cur_pickup_extra, v_cur_return_extra,
         v_cur_return_method, v_product_id
  FROM rental_reservations
  WHERE id = p_reservation_id AND user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN; -- 기존 동작과 동일: 소유자 불일치·존재하지 않는 예약이면 조용히 무시
  END IF;

  -- 이전에 이미 반영된 연장분을 되돌려 "원래 요청했던 날짜"를 복원(방식을 여러 번
  -- 바꿔도 연장이 누적되지 않도록)
  v_base_start := v_cur_start + v_cur_pickup_extra;
  v_base_end   := v_cur_end   - v_cur_return_extra;

  v_new_return := COALESCE(p_return_method, v_cur_return_method);

  SELECT effective_start_date, effective_end_date, pickup_extra_days, return_extra_days
    INTO v_new_start, v_new_end, v_new_pickup_extra, v_new_return_extra
  FROM compute_holiday_extended_period(v_base_start, v_base_end, p_pickup_method, v_new_return);

  -- 새로 계산된 범위가 기존 잠금 범위보다 넓어질 수 있으므로, 같은 실물 재고를 쓰는 다른
  -- 활성 예약과 겹치는지 재확인(create_hold_reservation의 최초 재고잠금과 동일 조건)
  SELECT EXISTS (
    SELECT 1 FROM rental_reservations rr
    WHERE rr.product_id = v_product_id
      AND rr.id != p_reservation_id
      AND rr.status NOT IN ('cancelled', 'returned', 'completed', 'expired')
      AND daterange(rr.start_date, rr.end_date, '[]') &&
          daterange(v_new_start, v_new_end, '[]')
  ) INTO v_conflict;

  IF v_conflict THEN
    RAISE EXCEPTION 'holiday_extension_conflict: 선택한 방식은 휴무일로 인해 대여기간이 늘어나는데, 늘어나는 기간에 재고가 이미 다른 예약에 배정되어 있습니다.';
  END IF;

  UPDATE rental_reservations SET
    pickup_method              = p_pickup_method,
    return_method               = v_new_return,
    pickup_time                 = p_pickup_time,
    return_time                 = p_return_time,
    pickup_address_road         = COALESCE(p_pickup_address_road, pickup_address_road),
    pickup_address_detail       = COALESCE(p_pickup_address_detail, pickup_address_detail),
    pickup_request_note         = COALESCE(p_pickup_request_note, pickup_request_note),
    return_request_note         = COALESCE(p_return_request_note, return_request_note),
    pickup_point_id              = p_pickup_point_id,
    return_point_id              = p_return_point_id,
    start_date                   = v_new_start,
    end_date                     = v_new_end,
    pickup_holiday_extra_days    = v_new_pickup_extra,
    return_holiday_extra_days    = v_new_return_extra
  WHERE id = p_reservation_id
    AND user_id = auth.uid();
END;
$function$;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Migration 479의 본문(휴무일 재계산 없음, 위 파라미터 목록 동일)으로 되돌리려면
-- 20260910010000_479_set_reservation_shipment_method_pickup_point.sql의
-- CREATE FUNCTION 블록(30~76행)을 CREATE OR REPLACE로 그대로 재실행할 것
-- (DROP 불필요 — 이번 마이그레이션도 파라미터 목록을 바꾸지 않았음).
-- ============================================================
