-- Migration #548: set_reservation_shipment_method — 결합상품 실물(reservation_bundle_assets) 겹침 재검사
-- 2026-09-24 | 결합상품 Phase 2 QA MEDIUM #1 | TDD: src/__tests__/services/bundleOverlapRecheck.test.ts
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh)
-- 의존성: #547(reservation_bundle_assets 표) 적용 후에만 적용 가능. Production은 #547과 함께.
--
-- 결함: #508은 수령/반납 방식 변경으로 휴무일 연장분을 재계산해 start/end를 넓힐 때 메인 실물(product_id)
--   겹침만 재확인한다. 패키지 예약에 배정된 결합 실물이 늘어난 기간에 다른 예약과 겹쳐도 통과해
--   결합 장비가 이중배정될 수 있었다.
-- 수정: 508 본문은 한 줄도 바꾸지 않고, 메인 겹침 검사 직후 "새 범위가 기존 범위보다 넓어진 경우에만"
--   이 예약의 결합 실물 각각을 (a) 다른 예약의 메인 배정 (b) 다른 패키지 예약의 결합 배정과 대조한다.
--   기준은 #547 assign_bundle_assets와 동일(status NOT IN cancelled/returned/completed/expired/draft,
--   daterange '[]' 겹침, 자기 예약 제외). 겹치면 RAISE EXCEPTION → 호출 트랜잭션 전체 롤백.
-- 시그니처·파라미터 무변경, DROP 없음 → 기존 ACL 유지(아래 REVOKE/GRANT는 재확인용).

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
  v_bundle_conflict  BOOLEAN;
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

  -- [#548] 범위가 넓어진 경우에만 결합 실물 겹침 재확인(좁아지거나 동일하면 재검사 없음)
  IF v_new_start < v_cur_start OR v_new_end > v_cur_end THEN
    SELECT EXISTS (
      SELECT 1
      FROM reservation_bundle_assets a
      WHERE a.reservation_id = p_reservation_id
        AND (
          EXISTS (
            SELECT 1 FROM rental_reservations rr
            WHERE rr.product_id = a.asset_product_id
              AND rr.id != p_reservation_id
              AND rr.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
              AND daterange(rr.start_date, rr.end_date, '[]') &&
                  daterange(v_new_start, v_new_end, '[]')
          )
          OR EXISTS (
            SELECT 1
            FROM reservation_bundle_assets a2
            JOIN rental_reservations rr2 ON rr2.id = a2.reservation_id
            WHERE a2.asset_product_id = a.asset_product_id
              AND a2.reservation_id != p_reservation_id
              AND rr2.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
              AND daterange(rr2.start_date, rr2.end_date, '[]') &&
                  daterange(v_new_start, v_new_end, '[]')
          )
        )
    ) INTO v_bundle_conflict;

    IF v_bundle_conflict THEN
      RAISE EXCEPTION 'bundle_holiday_extension_conflict: 선택한 방식은 휴무일로 인해 대여기간이 늘어나는데, 늘어나는 기간에 구성품 재고가 이미 다른 예약에 배정되어 있습니다.';
    END IF;
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

-- 권한 재확인(CREATE OR REPLACE는 기존 ACL 보존 — Migration 477과 동일 결과가 되도록 명시)
REVOKE ALL ON FUNCTION public.set_reservation_shipment_method(bigint, text, text, text, text, text, text, text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_reservation_shipment_method(bigint, text, text, text, text, text, text, text, text, uuid, uuid) TO authenticated, service_role;

-- ============================================================
-- ROLLBACK 초안 (별도 마이그레이션으로 적용 — 이 파일은 수정하지 않음)
-- 20260919000000_508_set_reservation_shipment_method_holiday_extension_fix.sql 의
-- CREATE OR REPLACE FUNCTION 블록(35~139행)을 그대로 재실행 후 위 REVOKE/GRANT 2줄 재실행.
-- ============================================================
