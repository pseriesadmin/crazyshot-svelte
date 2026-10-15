-- Migration #713: 임시예약(draft)에는 예약코드를 발행하지 않는다 — 예약신청(hold 승격) 시점에 한 번만 발행 (2026-10-15, Stephen 확정)
--
-- 배경: 예약코드는 "주문 1건 = 코드 1개"(Migration 400·649)가 정책인데, 장바구니 담기마다 만들어지는 임시예약(draft)도 INSERT 트리거로 코드를 받아
--       담기·취소가 반복될 때마다 코드 번호가 소모되고 실제 예약 코드 사이에 빈 번호가 생겼다(예: 신청 건 CSRSV26100089 앞뒤로 취소 임시예약 85~88·90).
-- 변경: set_reservation_code가 draft·취소·만료 상태에는 코드를 만들지 않는다. 트리거를 INSERT + 상태 변경(UPDATE OF status)에 걸어,
--       draft → hold 승격 때(예약신청) 코드를 처음 받는다. 이미 코드가 있으면(기존 데이터) 건드리지 않는다.
--       현재 draft 상태 행의 코드는 비운다(아직 제출 전이라 어디에도 쓰이지 않음).
-- 롤백: 트리거를 BEFORE INSERT 전용으로 되돌리고 함수를 "NEW.reservation_code IS NULL이면 생성"으로 복원.

CREATE OR REPLACE FUNCTION public.set_reservation_code()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.reservation_code IS NULL AND NEW.status NOT IN ('draft', 'cancelled', 'expired') THEN
    NEW.reservation_code := generate_reservation_code();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS reservation_code_trigger ON public.rental_reservations;
CREATE TRIGGER reservation_code_trigger
  BEFORE INSERT OR UPDATE OF status ON public.rental_reservations
  FOR EACH ROW
  WHEN (NEW.reservation_code IS NULL)
  EXECUTE FUNCTION public.set_reservation_code();

UPDATE public.rental_reservations SET reservation_code = NULL WHERE status = 'draft' AND reservation_code IS NOT NULL;
