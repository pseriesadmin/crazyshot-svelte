-- Migration 395 — orders.delivery_fee 추가 + create_reservation_order 반영 (2026-08-31)
--
-- 문제(Stephen 지적 — "F1은 장바구니 정책 로직이 혼돈되서 발생한 건"): 장바구니 화면
-- (cart/+page.svelte otTotal)은 "대여료 + 배송비 - 쿠폰 - 포인트"를 고객에게 총액으로
-- 보여주는데, 실제로 그 배송비가 orders.final_amount에도, 계약서명 결제 화면
-- (/contract/[token])의 실제 Toss 청구금액(payTotal)에도 전혀 반영되지 않고 있었다.
-- Stage DB 실측(유일한 실결제 건, reservation 4688): payment_transactions.delivery_fee=NULL,
-- paid_amount=주문 final_amount(대여료만) — 고객이 장바구니에서 본 총액과 실제 청구액이
-- 달랐음(toss_payments_pg_integration_2026-08-30.md F1 후속 조사로 발견).
--
-- 수정(Stephen 확정): 배송비를 orders.final_amount(및 실결제 금액)에 포함시킨다.
--   장바구니(cart/+page.svelte)가 이미 정확히 계산해 고객에게 보여준 배송비 값(otDeliveryFee,
--   배송비 우대할인 등 전부 반영된 최종값)을 create_reservation_order에 새 파라미터로 전달해
--   final_amount 계산에 더한다 — 배송비 계산 로직 자체를 SQL로 재구현하지 않는다(이미
--   Migration 374/375/381/382/385로 완성된 등급별 우대할인 로직과 중복 구현 방지).
--
-- 계산 순서: final_amount = 대여료 합계(v_total) - 멤버십 등급 할인(v_discount) + 배송비
--   (쿠폰/포인트는 기존대로 계약서명 화면에서 별도 차감 — orders.selected_coupon_id/
--   selected_points로 캐시만 하고 final_amount 자체는 건드리지 않는 기존 설계 유지)
--
-- 재호출 시 최신값으로 덮어씀 — selected_coupon_id/selected_points와 동일 원칙("가장 최근
-- 제출값이 저장된다").

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_fee INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.create_reservation_order(
  p_user_id            UUID,
  p_reservation_ids    BIGINT[],
  p_selected_coupon_id UUID DEFAULT NULL,
  p_selected_points    INTEGER DEFAULT 0,
  p_delivery_fee       INTEGER DEFAULT 0
)
RETURNS TABLE(order_id BIGINT, order_key TEXT, final_amount NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_grade         TEXT;
  v_rate          NUMERIC := 0;
  v_total         NUMERIC := 0;
  v_discount      NUMERIC := 0;
  v_final         NUMERIC := 0;
  v_order_id      BIGINT;
  v_order_key     TEXT;
  v_count         INT;
  v_seq           INT;
  v_today         TEXT;
  v_coupon_id     UUID;
  v_points        INTEGER;
  v_delivery_fee  INTEGER;
  r               RECORD;
  line            RECORD;
BEGIN
  IF p_user_id IS NULL OR p_reservation_ids IS NULL OR array_length(p_reservation_ids, 1) IS NULL THEN
    RAISE EXCEPTION '주문을 생성할 예약이 없습니다.';
  END IF;

  -- 소유·상태 방어적 재검증 (create_checkout_order와 동일 원칙)
  SELECT COUNT(*) INTO v_count
  FROM rental_reservations
  WHERE id = ANY(p_reservation_ids) AND user_id = p_user_id AND status = 'hold';

  IF v_count IS DISTINCT FROM array_length(p_reservation_ids, 1) THEN
    RAISE EXCEPTION '본인 소유의 신청대기(hold) 예약만 주문으로 묶을 수 있습니다.';
  END IF;

  -- 사전선택 쿠폰 소유권 검증 — 본인 쿠폰이 아니면 조용히 무시(실제 소진은 어차피 pay-mock
  -- 시점에 use_coupon이 다시 검증하므로, 여기선 하드 에러로 체크아웃 흐름을 막지 않는다)
  v_coupon_id := p_selected_coupon_id;
  IF v_coupon_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM user_coupons WHERE id = v_coupon_id AND user_id = p_user_id
  ) THEN
    v_coupon_id := NULL;
  END IF;
  v_points       := GREATEST(0, COALESCE(p_selected_points, 0));
  v_delivery_fee := GREATEST(0, COALESCE(p_delivery_fee, 0));

  -- 멱등 가드: p_reservation_ids 중 이미 order_items에 연결된 게 있으면, 그중 가장 먼저
  -- 생성된 order를 재사용한다(2개 이상 서로 다른 order로 갈라져 있는 드문 충돌 케이스도
  -- "가장 먼저 생성된 order"로 수렴시켜 처리 — 기존 연결을 이동/삭제하지 않고 그대로 둔다).
  SELECT o.id INTO v_order_id
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  WHERE oi.reservation_id = ANY(p_reservation_ids)
  ORDER BY o.created_at ASC
  LIMIT 1;

  SELECT membership_grade INTO v_grade FROM user_profiles WHERE id = p_user_id;
  v_rate := CASE COALESCE(v_grade, 'NONE')
    WHEN 'POP'   THEN 10
    WHEN 'CRAZY' THEN 20
    ELSE 0
  END;

  IF v_order_id IS NULL THEN
    -- 신규 주문 생성 — order_key 원자적 채번 (reservation_code_sequences와 동일 패턴:
    -- 신규 날짜(seq=1): INSERT next_seq=2, RETURNING 2-1=1
    -- 기존 날짜(seq=N): UPDATE next_seq=N+1, RETURNING (N+1)-1=N
    v_today := TO_CHAR(NOW(), 'YYYYMMDD');
    INSERT INTO order_key_sequences (seq_date, next_seq)
    VALUES (v_today, 2)
    ON CONFLICT (seq_date) DO UPDATE SET next_seq = order_key_sequences.next_seq + 1
    RETURNING order_key_sequences.next_seq - 1 INTO v_seq;

    IF v_seq IS NULL THEN v_seq := 1; END IF;

    v_order_key := 'ORD-' || v_today || '-' || LPAD(v_seq::TEXT, 5, '0');

    INSERT INTO orders (order_key, user_id, total_amount, discount_amount, tax_amount, final_amount, status)
    VALUES (v_order_key, p_user_id, 0, 0, 0, 0, 'pending')
    RETURNING id INTO v_order_id;
  ELSE
    SELECT o.order_key INTO v_order_key FROM orders o WHERE o.id = v_order_id;
  END IF;

  -- 어느 주문에도 아직 연결 안 된 id만 이 주문에 신규 연결
  FOR r IN
    SELECT rr.id, rr.product_id
    FROM rental_reservations rr
    WHERE rr.id = ANY(p_reservation_ids)
      AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.reservation_id = rr.id)
  LOOP
    SELECT * INTO line FROM compute_reservation_line_amount(r.id);

    INSERT INTO order_items (order_id, reservation_id, product_id, quantity, unit_price, line_total)
    VALUES (v_order_id, r.id, r.product_id, 1, line.rental_fee, line.rental_fee + line.options_fee);
  END LOOP;

  -- 금액 재계산 — 이 주문에 현재 연결된 order_items 전체 기준(기존 연결분 포함, 재사용 시에도 정합)
  SELECT COALESCE(SUM(oi.line_total), 0) INTO v_total
  FROM order_items oi WHERE oi.order_id = v_order_id;

  v_discount := ROUND(v_total * v_rate / 100.0);
  -- 2026-08-31(Migration 395): 배송비를 최종 결제금액에 합산 — 쿠폰/포인트는 기존대로
  -- 계약서명 화면(payTotal)에서 별도 차감(final_amount 자체엔 미반영, selected_* 캐시만).
  v_final    := v_total - v_discount + v_delivery_fee;

  UPDATE orders
  SET total_amount = v_total, discount_amount = v_discount, final_amount = v_final,
      selected_coupon_id = v_coupon_id, selected_points = v_points, delivery_fee = v_delivery_fee
  WHERE id = v_order_id;

  RETURN QUERY SELECT v_order_id, v_order_key, v_final;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_reservation_order(UUID, BIGINT[], UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_reservation_order(UUID, BIGINT[], UUID, INTEGER, INTEGER)
  TO service_role;

-- 기존 4-param 시그니처 오버로드 제거(신규 5-param 버전으로 통일 — PostgREST 오버로드
-- 모호성 방지, products.md §2-3 generate_product_code 사례와 동일 원칙)
DROP FUNCTION IF EXISTS public.create_reservation_order(UUID, BIGINT[], UUID, INTEGER);
