-- Migration 251b: create_checkout_order/compute_reservation_line_amount anon 실행권한 긴급 차단
--
-- 배경: @sp3-qa-agent 검수에서 발견 — Migration 251의 REVOKE 구문이 `FROM PUBLIC`만 명시하고
-- Migration 172(20260727000172_172_lock_server_only_rpcs_to_service_role.sql)의 검증된 패턴인
-- `FROM PUBLIC, anon, authenticated`를 따르지 않아, Supabase Postgres가 함수 생성 시 anon/
-- authenticated 롤에 자동 부여하는 기본 EXECUTE 권한이 회수되지 않은 채 남아있었다.
-- 실제 REST 호출로 anon이 create_checkout_order(타인 p_user_id 포함 임의 파라미터)를 직접
-- 실행 가능함을 확인 — Stage·Production 양쪽 즉시 차단·검증 완료(2026-08-15).
--
-- calculate_cart_total은 그대로 anon/authenticated 실행 가능 유지 — 원래도 그렇게 설계된
-- 함수(auth.uid() 내부 검증 + 본인 소유 예약만 조회하는 안전한 패턴)이며 이번 결함과 무관.
-- 내부적으로 compute_reservation_line_amount를 호출하지만 두 함수 모두 소유자가 postgres라
-- SECURITY DEFINER 중첩 호출은 소유자 권한으로 실행되어 이번 REVOKE로 깨지지 않음(검증 완료).

REVOKE ALL ON FUNCTION public.create_checkout_order(UUID, BIGINT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_checkout_order(UUID, BIGINT[]) TO service_role;

REVOKE ALL ON FUNCTION public.compute_reservation_line_amount(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_reservation_line_amount(BIGINT) TO service_role;
