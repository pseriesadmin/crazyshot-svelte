-- Migration 607 — use_coupons 실행 권한을 service_role 전용으로 잠금 (2026-10-01, sp3-qa-agent GATE E M-1)
--
-- 배경: Migration 532가 use_coupons(p_user_id, p_order_id, p_user_coupon_ids)를 authenticated에도 열어 두었다.
--   이 함수는 p_user_id를 그대로 신뢰하고(auth.uid() 검증 없음) 쿠폰 소진·order_coupons 기록·주문 금액 재계산까지 수행한다.
--   실제 호출자는 서버(consumeCoupons.ts → service_role admin 클라이언트)뿐이라 authenticated 권한은 불필요하다(브라우저 호출 없음).
-- 조치: authenticated/anon/PUBLIC 실행 권한 회수, service_role만 허용. 함수 본문은 무변경.

REVOKE ALL ON FUNCTION public.use_coupons(UUID, BIGINT, UUID[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.use_coupons(UUID, BIGINT, UUID[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.use_coupons(UUID, BIGINT, UUID[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.use_coupons(UUID, BIGINT, UUID[]) TO service_role;

-- ROLLBACK(참고용)
-- GRANT EXECUTE ON FUNCTION public.use_coupons(UUID, BIGINT, UUID[]) TO authenticated;
