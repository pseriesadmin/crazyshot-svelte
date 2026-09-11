-- Migration 479: set_reservation_shipment_method에 pickup_point_id/return_point_id 파라미터 추가
--
-- 배경(2026-09-10, Stephen 확정): rental_reservations.pickup_point_id/return_point_id
-- 컬럼(Migration #452, 2026-09-07)은 그때 "예약 생성/수정 시 이 값을 실제로 채워 넣는
-- 경로는 별도 스코프"로 명시적으로 미루고 컬럼만 추가한 상태였다. 어제(2026-09-09)
-- Migration #476 주석의 "방문지점은 방문 시 목록에서 선택해 값을 가져오는 구조라 별도
-- 저장 불필요"는 지점 "선택 UI가 콤보버튼 방식(직접 텍스트입력이 아님)"이라는 의미였을
-- 뿐, 저장 자체가 불필요하다는 뜻이 아니었다(Stephen 정정) — 실제로는 이 컬럼이 계속
-- NULL로 남아, 전자계약 "구분" 섹션의 {{수령방법지점}}/{{반납방법지점}}(contract-data/
-- +server.ts, "방식명 (지점명)" 조합 로직 자체는 정상)이 지점명 없이 방식명만 표시되는
-- 결함으로 이어졌다. 장바구니(cart/+page.svelte) "방문" 선택 시 지점 콤보버튼 UI
-- (bulkForm.pickupPointId/returnForm.pickupPointId, 2026-09-07 신규)는 이미 존재하지만,
-- 예약신청완료 시점에 호출하는 set_reservation_shipment_method RPC에 이 값을 넘길
-- 파라미터가 없어 서버로 전달되지 못하고 버려지고 있었다.
--
-- ⚠️ Migration #476이 문서화한 함정을 그대로 재현하지 않기 위해 9-param 오버로드를
-- 명시적으로 DROP한 뒤 11-param으로 CREATE한다(파라미터 목록이 늘어나면 CREATE OR
-- REPLACE만으로는 새 오버로드가 추가돼 기존 5-param/9-param 실호출과 모호성 충돌이
-- 발생함 — Migration #476 주석 참고). 3-param(레거시, Migration 171) 오버로드는 실호출이
-- 없어 그대로 유지.
--
-- pickup_point_id/return_point_id는 pickup_time/return_time과 동일하게 "매 제출 시점의
-- 현재 폼 상태를 그대로 반영"하는 방식 선택 종속 필드라 COALESCE(이전 값 보존)가 아니라
-- 직접 SET한다 — 수령·반납 방식이 방문이 아닌 값으로 바뀌면 지점도 함께 비워져야 정합.

DROP FUNCTION IF EXISTS public.set_reservation_shipment_method(
  bigint, text, text, text, text, text, text, text, text
);

CREATE FUNCTION public.set_reservation_shipment_method(
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

  UPDATE rental_reservations SET
    pickup_method          = p_pickup_method,
    return_method          = COALESCE(p_return_method, return_method),
    pickup_time            = p_pickup_time,
    return_time            = p_return_time,
    pickup_address_road    = COALESCE(p_pickup_address_road, pickup_address_road),
    pickup_address_detail  = COALESCE(p_pickup_address_detail, pickup_address_detail),
    pickup_request_note    = COALESCE(p_pickup_request_note, pickup_request_note),
    return_request_note    = COALESCE(p_return_request_note, return_request_note),
    pickup_point_id        = p_pickup_point_id,
    return_point_id        = p_return_point_id
  WHERE id = p_reservation_id
    AND user_id = auth.uid();
END;
$function$;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Migration 476의 정의(pickup_point_id/return_point_id 파라미터 없음)로 복원하려면:
-- 1) DROP FUNCTION IF EXISTS public.set_reservation_shipment_method(
--      bigint, text, text, text, text, text, text, text, text, uuid, uuid
--    );
-- 2) Migration 20260909070000_476_rental_reservations_request_note_columns.sql의
--    CREATE OR REPLACE FUNCTION 블록(43~85행)을 그대로 재실행
-- ============================================================
