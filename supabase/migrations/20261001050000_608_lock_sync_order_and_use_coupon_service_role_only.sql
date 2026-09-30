-- Migration 608 — sync_order_after_composition_change·use_coupon 실행 권한을 service_role 전용으로 잠금 (2026-10-01, 607 후속 잔여 2건)
--
-- 배경: DRIFT 점검(2026-10-01)에서 Stage·Production 모두 아래 두 함수가 service_role 외에도 열려 있음을 확인했다.
--   · sync_order_after_composition_change(BIGINT): anon·authenticated 실행 가능 — 주문 번호(순차 숫자)만 알면 비인증 사용자도
--     그 주문의 금액·order_coupons 할인액·예약코드 재계산(쓰기)을 일으킬 수 있었다(결과 값은 항상 같아 금액 위조는 아니나 비인증 쓰기 경로).
--   · use_coupon(UUID, UUID, BIGINT): authenticated 실행 가능 — p_user_id를 그대로 신뢰(auth.uid() 검증 없음).
-- 호출 경로 전수 확인(잠금 전): 앱 코드(src)의 직접 호출 없음, 브라우저 호출 없음. DB 내부 호출자는 전부 SECURITY DEFINER
--   (use_coupons·cms_add_reservation_product_unit·cms_remove_reservation_product_unit → 소유자 권한으로 실행되어 영향 없음).
--   트리거·pg_cron·뷰 호출 없음. 테스트는 service_role 클라이언트 사용. 함수 본문은 무변경, 권한만 회수.

REVOKE ALL ON FUNCTION public.sync_order_after_composition_change(BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_order_after_composition_change(BIGINT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_order_after_composition_change(BIGINT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sync_order_after_composition_change(BIGINT) TO service_role;

REVOKE ALL ON FUNCTION public.use_coupon(UUID, UUID, BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.use_coupon(UUID, UUID, BIGINT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.use_coupon(UUID, UUID, BIGINT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.use_coupon(UUID, UUID, BIGINT) TO service_role;

-- ROLLBACK(참고용)
-- GRANT EXECUTE ON FUNCTION public.sync_order_after_composition_change(BIGINT) TO anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.use_coupon(UUID, UUID, BIGINT) TO authenticated;
