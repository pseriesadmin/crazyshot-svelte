-- Migration 396 — 고아 레거시 결제 RPC 3종 삭제 (2026-08-31, Stephen 승인)
--
-- 배경(toss_payments_pg_integration_2026-08-30.md F2): 2026-08-31에 삭제된 레거시
-- 체크아웃 라우트 4개(/payment/success, /payment/fail, /api/payment/confirm,
-- /api/checkout/initiate)가 전용으로 호출하던 RPC 중 3종은 다른 어떤 라이브 코드에서도
-- 호출되지 않는 완전한 고아 상태임을 전수 grep으로 재확인 후 삭제한다.
--
-- ⚠️ calculate_cart_total은 같은 그룹으로 오판했다가 삭제 직전 재검증으로 정정 —
-- src/routes/cart/+page.server.ts가 타입캐스팅 호출 패턴으로 여전히 사용 중이라 삭제 대상에서
-- 제외했다(이 파일에서도 건드리지 않음).
--
-- 삭제 대상 3종:
--   1. confirm_payment_and_update_reservation — 레거시 단일예약 결제확정 RPC.
--      현재 라이브 결제는 confirm_order_payment_and_update_reservations(Migration 378,
--      주문 그룹 단위)로 완전히 대체됨.
--   2. cancel_payment_and_release_hold — 레거시 결제전 HOLD 포기 RPC.
--      살아있는 "카트 HOLD 취소" 경로(/api/reservations/cancel-hold/+server.ts)는 이 RPC가
--      status IN ('temp','pending','confirmed')만 처리해 'hold' 상태엔 적용 안 됨을 알고
--      의도적으로 update_reservation_status를 대신 사용 중.
--   3. atomic_reserve_asset — 레거시 단일상품 HOLD 원자배정 RPC.
--      현재 라이브 HOLD 배정은 create_hold_reservation으로 완전히 대체됨.
--
-- 롤백: git history의 각 RPC 최종 정의(atomic_reserve_asset은 Migration 61,
-- cancel_payment_and_release_hold는 Migration 281, confirm_payment_and_update_reservation은
-- Migration 303)를 CREATE OR REPLACE로 재실행.

DROP FUNCTION IF EXISTS public.confirm_payment_and_update_reservation(
  BIGINT, UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, JSONB,
  TIMESTAMP WITH TIME ZONE, INTEGER, NUMERIC, INTEGER
);

DROP FUNCTION IF EXISTS public.cancel_payment_and_release_hold(BIGINT, UUID, TEXT);

DROP FUNCTION IF EXISTS public.atomic_reserve_asset(UUID, DATE, DATE);
