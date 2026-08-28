-- Migration #373: 반납 배송선택 제한 서버단 강제(enforcement) 추가
--
-- 배경: Migration #372(restrict_return_delivery 컬럼 + 콤보 필터)는 클라이언트 표시
-- 목록에서만 배송 방식을 숨겼을 뿐, 실제 수령/반납 방식을 저장하는
-- set_reservation_shipment_method RPC는 이 값을 전혀 검증하지 않아 API를 직접 호출하면
-- 여전히 배송 방식이 저장될 수 있었다(@sp3-qa-agent 검수로 발견, CRITICAL #1).
--
-- 함께 발견된 CRITICAL #2(cart/+page.svelte bulkHandleMethod의 "요청 A" 강제복사 로직과의
-- 충돌 — 수령을 배송으로 고르면 반납도 강제로 배송이 되는데 반납 콤보에는 배송이 없어
-- 전부 비활성화되는 UI 데드엔드)는 클라이언트 수정(restrict_return_delivery ON이면 수령·
-- 반납 콤보 양쪽 모두에서 배송 제거, Stephen 확정)으로 해소했다. 이 마이그레이션은 그
-- 클라이언트 필터를 API 직접 호출로 우회하는 경로를 막는 서버측 이중 방어(defense-in-depth)다.
--
-- 클라이언트가 이제 수령·반납 양쪽 모두에서 배송을 숨기므로, 서버 가드도 동일하게
-- p_pickup_method·p_return_method 둘 다 검증한다.
--
-- 반환 타입 변경 없음(VOID 그대로) — CREATE OR REPLACE만으로 충분.

CREATE OR REPLACE FUNCTION public.set_reservation_shipment_method(
  p_reservation_id  BIGINT,
  p_pickup_method   TEXT,
  p_return_method   TEXT    DEFAULT NULL,
  p_pickup_time     TEXT    DEFAULT NULL,
  p_return_time     TEXT    DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_restricted BOOLEAN;
BEGIN
  SELECT restrict_return_delivery INTO v_restricted FROM rental_shipping_settings LIMIT 1;

  IF v_restricted THEN
    IF EXISTS (
      SELECT 1 FROM rental_method_options
      WHERE method_key = p_pickup_method AND is_bulk_delivery = true AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'return_delivery_restricted: 배송 방식은 현재 선택할 수 없습니다.';
    END IF;

    IF p_return_method IS NOT NULL AND EXISTS (
      SELECT 1 FROM rental_method_options
      WHERE method_key = p_return_method AND is_bulk_delivery = true AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'return_delivery_restricted: 반납 방식으로 배송을 선택할 수 없습니다.';
    END IF;
  END IF;

  UPDATE rental_reservations SET
    pickup_method = p_pickup_method,
    return_method = COALESCE(p_return_method, return_method),
    pickup_time   = p_pickup_time,
    return_time   = p_return_time
  WHERE id = p_reservation_id
    AND user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.set_reservation_shipment_method(BIGINT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_reservation_shipment_method(BIGINT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
