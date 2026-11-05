-- 794: 대여완료 자동종료(#279)를 예약 전용 상담 세션에만 적용 — 고객당 대화 1개 통합(#793)의 부작용 방지 (2026-11-05, sp3 검수 지적)
-- 배경: 예약이 완료(completed)되면 context_reservation_id 가 그 예약인 열린 세션을 모두 닫았다. 통합 이후 일반 대화(알림·상담이 한 곳에 쌓이는 대화)도
--       합치기·알림 RPC 로 예약 번호를 물려받으므로, 대여가 끝나는 순간 고객의 전체 대화가 '종료'로 분류될 수 있었다.
-- 변경: 닫는 대상을 context_type='reservation' 세션(구 예약 전용 세션)으로 한정. 일반 대화는 고객·관리자가 닫을 때까지 유지된다.
-- 되돌리기: 함수 본문에서 context_type 조건 한 줄 제거(#279 본문 복원)

CREATE OR REPLACE FUNCTION public.auto_close_chat_on_rental_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    UPDATE chat_sessions
    SET status = 'closed', updated_at = now()
    WHERE context_reservation_id = NEW.id
      AND context_type = 'reservation'
      AND status IN ('open', 'pending');
  END IF;
  RETURN NEW;
END;
$function$;
