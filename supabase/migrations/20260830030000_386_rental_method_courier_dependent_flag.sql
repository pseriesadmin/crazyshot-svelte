-- Migration #386: rental_method_options에 '휴무일 제한 대상(택배사 의존)' 플래그 신설
--
-- 배경(감사 RSC-B3, 2026-08-30): 휴무일 캘린더 제한(공휴일·일요일에 해당 방식의 날짜
-- 선택을 막는 기능, courierClosedMap)이 is_bulk_delivery("요청 A" — 수령=배송 선택 시
-- 반납을 같은 값으로 강제복사하는 완전히 다른 목적으로 만들어진 플래그, Migration #339)에
-- 그대로 얹혀 있었다. 지금은 Stage/Production 둘 다 실제 택배사 의존 방식(delivery·
-- crazydelivery)만 is_bulk_delivery=true라 우연히 문제가 없지만, 관리자가 "요청 A" 목적
-- 으로만 이 토글을 바꿔도(또는 반대로) 휴무일 캘린더가 의도치 않게 깨지는 구조적 위험이
-- 있어 별도 플래그로 분리한다(Stephen 확정: "별도 플래그 신설(구조적 해결)").
--
-- 백필: 기존 동작을 그대로 보존하기 위해 is_bulk_delivery 값을 그대로 이관한다(즉시
-- 적용 시점의 실사용자 영향 없음 — 이후 두 플래그는 관리자가 독립적으로 조정 가능).

ALTER TABLE rental_method_options
  ADD COLUMN IF NOT EXISTS is_courier_dependent BOOLEAN NOT NULL DEFAULT false;

UPDATE rental_method_options
SET is_courier_dependent = is_bulk_delivery;

CREATE OR REPLACE FUNCTION public.toggle_rental_method_courier_dependent(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row rental_method_options;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'unauthorized: cms role required';
  END IF;

  UPDATE rental_method_options
  SET is_courier_dependent = NOT is_courier_dependent
  WHERE id = p_id AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found: rental_method_option id %', p_id;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_rental_method_courier_dependent(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.toggle_rental_method_courier_dependent(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.toggle_rental_method_courier_dependent(UUID) TO authenticated;

-- ROLLBACK (수동 실행):
-- DROP FUNCTION IF EXISTS public.toggle_rental_method_courier_dependent(UUID);
-- ALTER TABLE rental_method_options DROP COLUMN IF EXISTS is_courier_dependent;
