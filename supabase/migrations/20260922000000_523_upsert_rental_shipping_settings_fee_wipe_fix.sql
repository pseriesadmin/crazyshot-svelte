-- Migration #523: upsert_rental_shipping_settings — 요금 값이 조용히 0(NULL)으로
-- 지워지던 CRITICAL 결함 수정
--
-- 배경(Stephen 실사용 중 발견, 2026-09-22): CMS `/cms/set/rental` "배송 설정"에서
-- 왕복요금·배송요금·반납요금 중 하나를 입력·저장했는데 "저장되었습니다" 토스트가 뜨면서
-- 다른(또는 전체) 요금이 0원(실제로는 NULL이라 입력칸이 비어 placeholder "0"으로 보임)으로
-- 초기화되는 현상이 보고됨.
--
-- 근본 원인: 이 RPC(Migration #152)의 UPDATE 문이
--   round_trip_fee = CASE WHEN p_enable_round_trip THEN p_round_trip_fee ELSE NULL END
-- 형태로, 그 요금의 "사용" 토글(enable_round_trip 등)이 false면 저장된 금액 자체를
-- NULL로 지워버리도록 설계돼 있었다. 그런데 이 화면의 요금 3종·배송 안내문·토글은 전부
-- 하나의 `<form action="?/saveShipping">`을 공유하고, 그 폼은 서로 다른 여러 트리거
-- (① 요금 입력칸 blur 시 자동제출 ② 토글 칩 클릭 시 자동제출 ③ "안내문 저장" 버튼 클릭)로
-- 각자 독립적으로 전체 폼을 제출한다 — 즉 안내문만 바꾸려고 저장해도 그 순간의 요금
-- 토글 상태에 따라 다른 요금이 함께 NULL로 지워질 수 있는 구조였다.
--
-- 결정적으로, 이 NULL 처리는 애초에 불필요했다 — 실제 요금 계산 로직
-- (src/lib/utils/cartShippingFee.ts calcShippingFee)은 이미 enable_round_trip 등
-- boolean 플래그를 저장된 요금 값과 완전히 독립적으로 먼저 확인해 false면 그 즉시 0을
-- 반환한다(`if (!settings.enable_round_trip) return 0`) — 저장된 round_trip_fee 값 자체는
-- 참조조차 하지 않는다. 즉 "토글 끄면 요금 값을 지운다"는 이 RPC의 동작은 실제 요금 산정에
-- 아무 영향도 주지 못하면서, 관리자가 토글을 껐다 켰을 때 이전에 입력해둔 가격이 통째로
-- 사라지는 부작용만 있었다(shipping_guide/holiday_guide_text 등 이 프로젝트의 다른 모든
-- "값 보존" 관례와도 상충).
--
-- 수정: CASE...NULL 로직을 제거하고 name/shipping_guide와 동일하게 항상 값을 그대로
-- 저장한다. enable_* 플래그는 여전히 그대로 저장되고, "이 요금을 실제로 부과할지"는
-- calcShippingFee가 이미 그 플래그만으로 독립 판정하므로 동작 변화 없음 — 오직 "토글을
-- 끄면 가격이 사라지는" 부작용만 제거된다.
--
-- 시그니처는 무변경(7-param 그대로) — CREATE OR REPLACE로 같은 함수 객체를 교체하므로
-- 기존 GRANT는 유지되나, 2026-09-15 compute_reservation_line_amount 하드닝 누락 사고
-- 재발 방지 원칙에 따라 명시적으로 재적용한다(belt-and-suspenders).

CREATE OR REPLACE FUNCTION public.upsert_rental_shipping_settings(
  p_enable_round_trip BOOLEAN,
  p_round_trip_fee    INTEGER,
  p_enable_delivery   BOOLEAN,
  p_delivery_fee      INTEGER,
  p_enable_return     BOOLEAN,
  p_return_fee        INTEGER,
  p_shipping_guide    VARCHAR
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_cms_user() THEN
    RAISE EXCEPTION 'CMS 권한이 필요합니다.';
  END IF;

  UPDATE rental_shipping_settings SET
    enable_round_trip = p_enable_round_trip,
    round_trip_fee    = p_round_trip_fee,
    enable_delivery   = p_enable_delivery,
    delivery_fee      = p_delivery_fee,
    enable_return     = p_enable_return,
    return_fee        = p_return_fee,
    shipping_guide    = p_shipping_guide,
    updated_at        = now()
  WHERE true;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_rental_shipping_settings(BOOLEAN, INTEGER, BOOLEAN, INTEGER, BOOLEAN, INTEGER, VARCHAR) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_rental_shipping_settings(BOOLEAN, INTEGER, BOOLEAN, INTEGER, BOOLEAN, INTEGER, VARCHAR) TO authenticated;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Migration #152 원본의 CASE...NULL 로직을 그대로 재실행(비권장 — 이 결함을 다시 들여옴)
-- ============================================================
