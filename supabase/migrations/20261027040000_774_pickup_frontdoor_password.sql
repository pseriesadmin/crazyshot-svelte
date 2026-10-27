-- Migration 774: 수령 공동현관 출입번호 전용 칸 — 두발히어로 frontdoorPassword(운송장 미인쇄·라이더앱 전용)로 전달 (2026-10-27, Stephen 확정 "C안")
--
-- 배경: 장바구니 "요청 사항"(자유 입력)은 두발히어로 memoFromCustomer(운송장에 인쇄됨)로 전달되므로, 고객이 거기 적은 공동현관 출입번호가
--   라벨에 그대로 찍힌다. 안내서에는 인쇄되지 않는 전용 칸 frontdoorPassword(50자, 라이더앱에만 노출)가 있어 출입번호만 별도 칸으로 받는다.
--
-- 내용:
--   1) rental_reservations.pickup_frontdoor_password TEXT (최대 50자) — 수령(배송) 주소의 공동현관 출입번호. 반납 leg 는 두발히어로 반품 API 에 해당 칸이 없어 만들지 않는다.
--   2) set_reservation_frontdoor_password(예약id, 값) — 고객 본인 예약만, 출고 전 상태(draft·hold·pending·confirmed)이면서 운송장(접수번호)이 아직 없을 때만(허용 목록 — 접수 후에 바꾸면 CMS 와 두발히어로 값이 어긋나므로, 종결 상태 누락 사고 방지). 제어문자·방향제어 문자는 제거한다. 빈 값은 NULL 로 비운다.
--      기존 set_reservation_shipment_method(9~12-param, 오버로드 모호성 이력 Migration 434·476)는 건드리지 않고 별도 함수로 둔다.
--   3) 서버 전용이 아니라 고객 장바구니가 직접 호출하므로 authenticated 실행 허용, anon·PUBLIC 차단(Migration 477 선례).
--
-- 롤백(별도 마이그레이션): DROP FUNCTION public.set_reservation_frontdoor_password(bigint, text); ALTER TABLE public.rental_reservations DROP COLUMN pickup_frontdoor_password;

ALTER TABLE public.rental_reservations
  ADD COLUMN IF NOT EXISTS pickup_frontdoor_password TEXT;

ALTER TABLE public.rental_reservations
  DROP CONSTRAINT IF EXISTS rental_reservations_pickup_frontdoor_password_len;
ALTER TABLE public.rental_reservations
  ADD CONSTRAINT rental_reservations_pickup_frontdoor_password_len
  CHECK (pickup_frontdoor_password IS NULL OR char_length(pickup_frontdoor_password) <= 50);

COMMENT ON COLUMN public.rental_reservations.pickup_frontdoor_password IS
  '수령(배송) 주소의 공동현관 출입번호 — 장바구니 전용 입력칸. 두발히어로 접수 frontdoorPassword(운송장 미인쇄·라이더앱 전용)로 전달. 최대 50자.';

CREATE OR REPLACE FUNCTION public.set_reservation_frontdoor_password(
  p_reservation_id bigint,
  p_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- 제어문자(개행·탭 등)와 방향 제어·제로폭 문자(U+200B–200F, U+202A–202E, U+2066–2069)를 제거한 뒤 앞뒤 공백을 지운다 — 라이더앱·관리자 화면 표시가 흐트러지지 않게(sp5 LOW)
  v_pw text := NULLIF(btrim(regexp_replace(COALESCE(p_password, ''), '[\u0001-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]', '', 'g')), '');
BEGIN
  IF v_pw IS NOT NULL AND char_length(v_pw) > 50 THEN
    RAISE EXCEPTION 'frontdoor_password_too_long: 공동현관 출입번호는 50자까지 입력할 수 있습니다.';
  END IF;

  -- 소유자 불일치·존재하지 않는 예약·출고 후 상태면 조용히 무시(set_reservation_shipment_method 와 같은 '조용한 무시' 원칙)
  UPDATE public.rental_reservations
  SET pickup_frontdoor_password = v_pw
  WHERE id = p_reservation_id
    AND user_id = auth.uid()
    AND status IN ('draft', 'hold', 'pending', 'confirmed')
    AND tracking_number IS NULL;  -- 운송장(접수번호)이 생긴 뒤에는 바꾸지 않는다 — CMS 값과 두발히어로 전달 값이 어긋나는 것을 막는다(sp5 LOW)
END;
$function$;

REVOKE ALL ON FUNCTION public.set_reservation_frontdoor_password(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_reservation_frontdoor_password(bigint, text) TO authenticated, service_role;
