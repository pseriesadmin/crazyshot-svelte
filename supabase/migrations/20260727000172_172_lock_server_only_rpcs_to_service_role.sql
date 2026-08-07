-- Migration 172: 서버 전용 RPC 4종 service_role 전용 잠금 (BL-SEC-1 대응)
-- 배경: BL-LC-R6 조사 중 발견 — update_reservation_status가 소유자 검증 없이
--   anon/authenticated에게도 EXECUTE 권한이 열려있음을 확인.
--   실사용 코드 grep 결과, 아래 4개 RPC는 전부 admin.rpc()(service_role)로만 호출되며
--   클라이언트에서 직접 호출하는 경로가 전혀 없음:
--     · update_reservation_status              (cms/reservation, confirm-mock)
--     · send_rental_chat_notification           (cms/rentals, cms/reservation, confirm-mock, notify-hold)
--     · confirm_payment_and_update_reservation  (payment/success, api/payment/confirm)
--     · cancel_payment_and_release_hold         (payment/fail, api/payment/confirm)
--   특히 confirm_payment_and_update_reservation / cancel_payment_and_release_hold는
--   p_user_id를 파라미터로 직접 신뢰(auth.uid() 미검증)하므로, anon/authenticated 노출 시
--   타인 명의의 결제 확정·취소를 임의로 호출할 수 있는 심각한 취약점.
--   update_reservation_status는 소유자 검증 자체가 없어 임의 예약의 상태를 누구나 변경 가능.
--
-- create_hold_reservation은 제외 — 클라이언트가 본인 세션으로 직접 호출하는 것이 의도된
--   설계이며, 함수 내부에 auth.uid() 검증이 이미 존재함 (수정 불필요).
--
-- 조치: PUBLIC 권한 회수 후 service_role에만 재부여 (REVOKE + GRANT)

REVOKE EXECUTE ON FUNCTION public.update_reservation_status(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_reservation_status(bigint, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.send_rental_chat_notification(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_rental_chat_notification(bigint, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.confirm_payment_and_update_reservation(
  bigint, uuid, text, text, text, integer, integer, integer, integer, text, jsonb, timestamptz, integer, numeric, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_payment_and_update_reservation(
  bigint, uuid, text, text, text, integer, integer, integer, integer, text, jsonb, timestamptz, integer, numeric, integer
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.cancel_payment_and_release_hold(bigint, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_payment_and_release_hold(bigint, uuid, text) TO service_role;
