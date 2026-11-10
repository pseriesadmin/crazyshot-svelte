-- Migration 806: 반납 주소 저장 칸 — 배송형 반납에서 고객이 장바구니에 입력한 반납 주소를 예약에 남겨 관리자 화면(대여 방법)에 보여준다 (2026-11-10, Stephen 지시)
--
-- 배경: 장바구니는 배송형(택배·크레이지배송) 반납에서도 반납 주소를 입력받지만, 수령 주소(pickup_address_*)만 서버에 저장되고 반납 주소는 허용지역 검사에만 쓰이고 사라졌다.
--   그 결과 관리자가 "반납은 택배"인 예약에서 어디로 회수하는지 화면에서 확인할 수 없었다.
--
-- 내용:
--   1) rental_reservations.return_address_road / return_address_detail / return_postal_code — 반납 주소 스냅샷(예약신청 시점). 길이 상한 200·200·10.
--   2) set_reservation_return_address(예약id, 도로명, 상세, 우편번호) — 고객 본인 예약만, 출고 전 상태(draft·hold·pending·confirmed)일 때만.
--      제어문자·방향제어 문자는 제거, 빈 값은 NULL. 소유자 불일치·없는 예약·해당 상태가 아니면 조용히 무시(set_reservation_frontdoor_password 와 같은 원칙).
--      기존 set_reservation_shipment_method(오버로드 모호성 이력 Migration 434·476)는 건드리지 않고 별도 함수로 둔다 — 장바구니가 이 함수만 실패해도 예약신청은 막히지 않는다(fail-soft).
--   3) 고객 장바구니가 직접 호출하므로 authenticated 실행 허용, anon·PUBLIC 차단(Migration 774 선례).
--
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh). 기존 마이그레이션 파일은 수정하지 않는다.
-- 롤백(별도 마이그레이션): DROP FUNCTION public.set_reservation_return_address(bigint, text, text, text); ALTER TABLE public.rental_reservations DROP COLUMN return_address_road, DROP COLUMN return_address_detail, DROP COLUMN return_postal_code;

ALTER TABLE public.rental_reservations
  ADD COLUMN IF NOT EXISTS return_address_road   TEXT,
  ADD COLUMN IF NOT EXISTS return_address_detail TEXT,
  ADD COLUMN IF NOT EXISTS return_postal_code    TEXT;

ALTER TABLE public.rental_reservations DROP CONSTRAINT IF EXISTS rental_reservations_return_address_len;
ALTER TABLE public.rental_reservations
  ADD CONSTRAINT rental_reservations_return_address_len
  CHECK (
    (return_address_road   IS NULL OR char_length(return_address_road)   <= 200) AND
    (return_address_detail IS NULL OR char_length(return_address_detail) <= 200) AND
    (return_postal_code    IS NULL OR char_length(return_postal_code)    <= 10)
  );

COMMENT ON COLUMN public.rental_reservations.return_address_road IS '반납(배송형) 주소 — 도로명. 장바구니 예약신청 시점 스냅샷, 관리자 화면 표시용.';
COMMENT ON COLUMN public.rental_reservations.return_address_detail IS '반납(배송형) 주소 — 상세주소.';
COMMENT ON COLUMN public.rental_reservations.return_postal_code IS '반납(배송형) 주소 — 우편번호.';

CREATE OR REPLACE FUNCTION public.set_reservation_return_address(
  p_reservation_id bigint,
  p_road text,
  p_detail text,
  p_postal_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- 제어문자(개행·탭 등)와 방향 제어·제로폭 문자(U+200B–200F, U+202A–202E, U+2066–2069)를 제거한 뒤 앞뒤 공백을 지운다(Migration 774 와 같은 정리 규칙)
  v_road   text := NULLIF(btrim(regexp_replace(COALESCE(p_road, ''),        '[\u0001-\u001F\u007F​-‏‪-‮⁦-⁩]', '', 'g')), '');
  v_detail text := NULLIF(btrim(regexp_replace(COALESCE(p_detail, ''),      '[\u0001-\u001F\u007F​-‏‪-‮⁦-⁩]', '', 'g')), '');
  v_postal text := NULLIF(btrim(regexp_replace(COALESCE(p_postal_code, ''), '[\u0001-\u001F\u007F​-‏‪-‮⁦-⁩]', '', 'g')), '');
BEGIN
  IF (v_road IS NOT NULL AND char_length(v_road) > 200) OR (v_detail IS NOT NULL AND char_length(v_detail) > 200) THEN
    RAISE EXCEPTION 'return_address_too_long: 반납 주소는 200자까지 입력할 수 있습니다.';
  END IF;
  IF v_postal IS NOT NULL AND char_length(v_postal) > 10 THEN
    RAISE EXCEPTION 'return_postal_code_too_long: 우편번호가 올바르지 않습니다.';
  END IF;

  -- 소유자 불일치·존재하지 않는 예약·출고 후 상태면 조용히 무시(허용 목록 — 종결 상태 누락 사고 방지)
  UPDATE public.rental_reservations
  SET return_address_road   = v_road,
      return_address_detail = v_detail,
      return_postal_code    = v_postal
  WHERE id = p_reservation_id
    AND user_id = auth.uid()
    AND status IN ('draft', 'hold', 'pending', 'confirmed');
END;
$function$;

REVOKE ALL ON FUNCTION public.set_reservation_return_address(bigint, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_reservation_return_address(bigint, text, text, text) TO authenticated, service_role;
