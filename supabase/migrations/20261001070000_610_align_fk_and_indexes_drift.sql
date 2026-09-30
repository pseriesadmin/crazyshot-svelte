-- Migration 610 — Stage↔Production 구조 드리프트 정렬: user_coupons FK·인덱스, order_items FK (2026-10-01)
--
-- 배경(DRIFT_CHECK 절차 3·4, 2026-10-01):
--   ① user_coupons.coupon_id FK: 저장소 Migration 16은 ON DELETE RESTRICT로 정의했으나 Production만 ON DELETE CASCADE였다.
--      CASCADE에서는 쿠폰 행을 물리 삭제하면 고객 보유 기록(user_coupons)이 조용히 연쇄 삭제된다(앱은 소프트삭제만 사용).
--   ② user_coupons 인덱스: Migration 16의 idx_user_coupons_user_id·idx_user_coupons_coupon_id가 Production에 없었다.
--   ③ order_items FK: orders/order_items는 저장소 마이그레이션 이전부터 있던 라이브 테이블이라 저장소 정의가 없다.
--      Production은 order_id ON DELETE CASCADE, reservation_id ON DELETE SET NULL, Stage는 기본(NO ACTION)이었다.
--      실제 서비스(Production) 동작에 Stage를 맞춘다(테스트 충실도). 앱에 이 테이블들의 물리 삭제 경로는 없어 런타임 영향은 잠복 상태였다.
-- 멱등: 현재 정의를 확인해 이미 같으면 건너뛴다(Stage는 ①② 무변경, Production은 ③ 무변경).
-- 적용 이력: Stage 2026-10-01 05:25경 적용, Production은 같은 날 Stephen 승인 후 적용.

-- ① user_coupons.coupon_id → ON DELETE RESTRICT (저장소 Migration 16 정의)
DO $do$
DECLARE
  v_type "char";
BEGIN
  SELECT confdeltype INTO v_type
    FROM pg_constraint
   WHERE conname = 'user_coupons_coupon_id_fkey' AND conrelid = 'public.user_coupons'::regclass;
  IF v_type IS NOT NULL AND v_type <> 'r' THEN
    ALTER TABLE public.user_coupons DROP CONSTRAINT user_coupons_coupon_id_fkey;
    ALTER TABLE public.user_coupons
      ADD CONSTRAINT user_coupons_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES public.coupons(id) ON DELETE RESTRICT;
  END IF;
END
$do$;

-- ② user_coupons 인덱스 (저장소 Migration 16 정의)
CREATE INDEX IF NOT EXISTS idx_user_coupons_user_id   ON public.user_coupons(user_id);
CREATE INDEX IF NOT EXISTS idx_user_coupons_coupon_id ON public.user_coupons(coupon_id);

-- ③ order_items FK — Production 동작(주문 삭제 시 항목 CASCADE, 예약 삭제 시 연결만 SET NULL)에 맞춤
DO $do$
DECLARE
  v_type "char";
BEGIN
  SELECT confdeltype INTO v_type
    FROM pg_constraint
   WHERE conname = 'order_items_order_id_fkey' AND conrelid = 'public.order_items'::regclass;
  IF v_type IS NOT NULL AND v_type <> 'c' THEN
    ALTER TABLE public.order_items DROP CONSTRAINT order_items_order_id_fkey;
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
  END IF;

  SELECT confdeltype INTO v_type
    FROM pg_constraint
   WHERE conname = 'order_items_reservation_id_fkey' AND conrelid = 'public.order_items'::regclass;
  IF v_type IS NOT NULL AND v_type <> 'n' THEN
    ALTER TABLE public.order_items DROP CONSTRAINT order_items_reservation_id_fkey;
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.rental_reservations(id) ON DELETE SET NULL;
  END IF;
END
$do$;

-- ROLLBACK(참고용)
-- user_coupons_coupon_id_fkey를 ON DELETE CASCADE로 되돌리는 것은 권장하지 않는다(보유 기록 연쇄 삭제 위험).
-- DROP INDEX IF EXISTS idx_user_coupons_user_id, idx_user_coupons_coupon_id;  -- Stage 원상 유지 필요 시 주의
