-- Migration #701: set_reservation_shipment_method에 배송 허용지역 검사 추가 (2026-10-12)
-- 수령 방식이 배송형(is_delivery_type)이고 수령 주소가 전달된 경우, 허용지역 밖이면 예외.
-- 허용지역이 0건이면 private.is_address_in_delivery_area가 true를 돌려 기존 동작 그대로.
-- 라이브 정의에서 정확히 1곳(앵커)만 치환한다 — 앵커가 없거나 이미 적용돼 있으면 아무것도 하지 않고 알림만 남긴다.
-- 롤백: 이 함수를 Migration 548 정의로 되돌린다(CREATE OR REPLACE).

DO $$
DECLARE
  v_oid     oid;
  v_def     text;
  v_new     text;
  v_anchor  text := E'  SELECT start_date, end_date,\n         COALESCE(pickup_holiday_extra_days, 0), COALESCE(return_holiday_extra_days, 0),';
  v_insert  text := E'  IF p_pickup_address_road IS NOT NULL AND btrim(p_pickup_address_road) <> \'\'\n'
                 || E'     AND EXISTS (\n'
                 || E'       SELECT 1 FROM rental_method_options\n'
                 || E'       WHERE method_key = p_pickup_method AND is_delivery_type = true AND deleted_at IS NULL\n'
                 || E'     )\n'
                 || E'     AND NOT private.is_address_in_delivery_area(p_pickup_address_road)\n'
                 || E'  THEN\n'
                 || E'    RAISE EXCEPTION \'out_of_delivery_area: 배송 가능 지역이 아닙니다. 다른 주소를 입력하거나 방문 수령을 선택해 주세요.\';\n'
                 || E'  END IF;\n\n';
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'set_reservation_shipment_method'
    AND p.pronargs = 11;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '대상 함수(11개 인자)를 찾지 못했습니다';
  END IF;

  v_def := pg_get_functiondef(v_oid);
  IF position('is_address_in_delivery_area' IN v_def) > 0 THEN
    RAISE NOTICE '이미 적용됨 — 건너뜀';
    RETURN;
  END IF;
  IF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION '앵커를 찾지 못했습니다 — 라이브 정의가 예상과 다릅니다';
  END IF;

  v_new := replace(v_def, v_anchor, v_insert || v_anchor);
  -- private 스키마 함수를 쓰므로 search_path에 private 추가
  v_new := replace(v_new, E'SET search_path TO ''public''', E'SET search_path TO ''public'', ''private''');
  EXECUTE v_new;
END $$;
