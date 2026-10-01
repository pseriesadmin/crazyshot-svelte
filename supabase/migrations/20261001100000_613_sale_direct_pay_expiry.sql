-- Migration 613 — 판매전용 단독 직접결제 주문: 결제창 이탈(미결제) 30분 자동 만료 (2026-10-01, Stephen 확정)
--
-- 배경: 판매전용 상품만 담은 주문은 장바구니에서 곧바로 PG 결제창으로 연결된다(새 /checkout/pay). 예약(hold)은 결제 전에 재고를 잡아두는데,
-- 기존 정책상 계약서를 보내기 전의 hold는 만료되지 않아 결제창에서 이탈하면 그 재고가 계속 묶인다.
-- 정책: 직접결제를 시작한 "판매전용 단독" 주문의 미결제 hold만 30분 뒤 자동 만료(기존 신청 주문·대여 포함 주문은 전혀 영향 없음).
--
-- 안전장치:
--   · 새 컬럼 orders.direct_pay_expires_at(NULL=기존 동작). 직접결제 페이지가 처음 열릴 때만 now()+30분으로 설정한다.
--   · 만료 대상 = 기한이 지난 주문의 hold 예약 중 결제 미확인(payment_confirmed_at IS NULL)이고, 같은 주문의 모든 예약이 구매(판매전용)인 것.
--     (구매 판별: duration_type='purchase' 또는 상품이 판매전용 — 부모 우선)
--   · 이 만료는 채팅 알림("예약 만료")을 보내지 않는다 — 고객이 직접 결제창을 이탈한 것이라 별도 안내가 불필요하고, 신청 안내 카드도 보내지 않았다.
--   · release_reservation_hold 현행 정의의 첫 구문 앞에 블록 1개만 앵커 치환(멱등, 앵커 불일치 시 중단).
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS direct_pay_expires_at TIMESTAMPTZ;
COMMENT ON COLUMN public.orders.direct_pay_expires_at IS '판매전용 단독 직접결제 마감 시각(NULL=해당 없음). 지나면 미결제 hold가 release_reservation_hold로 자동 만료.';

DO $do$
DECLARE
  v_def TEXT;
  v_cnt INT;
  v_a TEXT := E'BEGIN\n  FOR v_reservation_id IN\n    SELECT rr.id';
  v_b TEXT := E'BEGIN\n  -- 판매전용 단독 직접결제 주문의 미결제 이탈 만료(Migration 613) — 알림 없이 조용히 만료\n  UPDATE public.rental_reservations rr\n     SET status = ''expired'', updated_at = NOW()\n   WHERE rr.status = ''hold''\n     AND rr.payment_confirmed_at IS NULL\n     AND EXISTS (\n       SELECT 1 FROM public.order_items oi\n         JOIN public.orders o ON o.id = oi.order_id\n        WHERE oi.reservation_id = rr.id\n          AND o.direct_pay_expires_at IS NOT NULL\n          AND o.direct_pay_expires_at < NOW()\n          AND NOT EXISTS (\n            SELECT 1 FROM public.order_items oi2\n              JOIN public.rental_reservations r2 ON r2.id = oi2.reservation_id\n              JOIN public.products p2 ON p2.id = r2.product_id\n              LEFT JOIN public.products pp2 ON pp2.id = p2.parent_product_id\n             WHERE oi2.order_id = oi.order_id\n               AND r2.duration_type IS DISTINCT FROM ''purchase''\n               AND NOT COALESCE(pp2.sale_only, p2.sale_only, false)\n          )\n     );\n  GET DIAGNOSTICS v_updated_count = ROW_COUNT;\n  v_expired_count := v_expired_count + v_updated_count;\n\n  FOR v_reservation_id IN\n    SELECT rr.id';
BEGIN
  SELECT pg_get_functiondef('public.release_reservation_hold()'::regprocedure) INTO v_def;
  IF position('direct_pay_expires_at' IN v_def) > 0 THEN RETURN; END IF;
  v_cnt := (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a);
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'release_reservation_hold anchor mismatch: %', v_cnt; END IF;
  EXECUTE replace(v_def, v_a, v_b);
END
$do$;

-- ROLLBACK(참고용): 컬럼은 남겨도 무해(NULL). 함수는 Migration 453 정의로 되돌린다.
