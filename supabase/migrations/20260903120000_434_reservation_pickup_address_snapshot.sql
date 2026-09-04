-- Migration 434: 예약별 "수령(pickup)" 주소 스냅샷 신설
--
-- 배경: 계약서 변수 {{주소}}가 예약과 무관하게 항상 그 순간의 "고객 프로필 기본 배송지"
-- (user_shipping_addresses.is_default=true)를 조회해왔다 — rental_reservations/orders
-- 어디에도 "이 예약이 실제로 어느 주소로 배송됐는지"를 저장하는 컬럼이 없었기 때문이다.
-- 장바구니 "배송지 정보" 입력창(기본주소 자동채움 또는 직접 입력)도 실제로는 화면 표시·
-- 금액계산용 로컬 상태일 뿐 서버로 전송되지 않았다(cart/+page.svelte 추적 확인 —
-- set_reservation_shipment_method 호출부에 주소 파라미터 자체가 없었음).
--
-- Stephen 확정: "장바구니 대여설정 '수령'정보의 등록(기본 주소지 or 직접 입력) 주소지를
-- 변수값으로 동기화 해야 정합" — "예약신청완료" 시점(장바구니 체크아웃)에 확정되는 값을
-- 스냅샷으로 저장한다(반납 주소는 이번 범위 밖).

-- ── 1. 컬럼 신설 ─────────────────────────────────────────────────────────────
ALTER TABLE public.rental_reservations
  ADD COLUMN IF NOT EXISTS pickup_address_road   TEXT,
  ADD COLUMN IF NOT EXISTS pickup_address_detail TEXT;

-- ── 2. set_reservation_shipment_method 확장 ─────────────────────────────────
-- 기존 5-param 오버로드(p_reservation_id, p_pickup_method, p_return_method, p_pickup_time,
-- p_return_time)를 명시적으로 DROP한 뒤 7-param(신규 2개는 DEFAULT NULL)으로 재생성한다 —
-- 두 오버로드를 동시에 남겨두면 PostgREST가 어느 쪽을 호출할지 모호해지는 문제
-- (products.md §2-3 PGRST203, Migration 340 선례)를 반복하지 않기 위함.
-- ⚠️ 별개의 3-param 오버로드(p_reservation_id, p_pickup_method, p_return_method)는
-- 이번 변경과 무관 — 손대지 않는다.
DROP FUNCTION IF EXISTS public.set_reservation_shipment_method(
  bigint, text, text, text, text
);

CREATE OR REPLACE FUNCTION public.set_reservation_shipment_method(
  p_reservation_id bigint,
  p_pickup_method text,
  p_return_method text DEFAULT NULL::text,
  p_pickup_time text DEFAULT NULL::text,
  p_return_time text DEFAULT NULL::text,
  p_pickup_address_road text DEFAULT NULL::text,
  p_pickup_address_detail text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    pickup_method          = p_pickup_method,
    return_method          = COALESCE(p_return_method, return_method),
    pickup_time            = p_pickup_time,
    return_time            = p_return_time,
    -- NULL 전달 시(호출부가 아직 미갱신이거나 값이 없을 때) 기존 값 보존 — COALESCE로
    -- 의도치 않은 초기화 방지(pickup_time/return_time과 달리 이 두 필드는 덮어쓰기 원칙이
    -- 다름 — 주소는 "빈 값으로 초기화"보다 "값 없으면 유지"가 안전).
    pickup_address_road    = COALESCE(p_pickup_address_road, pickup_address_road),
    pickup_address_detail  = COALESCE(p_pickup_address_detail, pickup_address_detail)
  WHERE id = p_reservation_id
    AND user_id = auth.uid();
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_reservation_shipment_method(
  bigint, text, text, text, text, text, text
) TO anon, authenticated, service_role;

COMMENT ON COLUMN public.rental_reservations.pickup_address_road IS
  '예약신청완료(장바구니 체크아웃) 시점에 확정된 수령 주소(도로명) — 계약서 {{주소}} 변수의
   정본 소스. NULL이면 이 컬럼 신설 이전 예약(하위호환) — contract-data API가
   user_shipping_addresses 기본 배송지로 폴백한다.';
COMMENT ON COLUMN public.rental_reservations.pickup_address_detail IS
  '예약신청완료 시점에 확정된 수령 주소(상세) — pickup_address_road와 동일 원칙.';
