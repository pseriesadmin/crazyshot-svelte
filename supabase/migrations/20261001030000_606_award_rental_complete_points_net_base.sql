-- Migration 606 — 렌탈완료 적립 기준을 "할인·포인트 차감 후 실결제 대여료(휴무일 연장요금 포함)"로 재정의 (A-1, 2026-10-01)
--
-- 배경: 기존(Migration 407/603)은 order_items.line_total 합계(할인 전 대여료+옵션)에 적립률을 곱했다.
--   그래서 쿠폰·멤버십 할인·포인트를 써도 적립이 줄지 않았고, 택배 앞뒤 휴무일 연장요금은 기준에서 빠져 있었다.
--
-- 새 기준금액(예약 1건) =
--     그 예약의 상품+옵션 금액(order_items.line_total)  +  그 예약의 휴무일 연장요금(compute_reservation_line_amount.holiday_extra_fee)
--   − (멤버십 할인 + 상품분 쿠폰 할인 + 실제 사용 포인트) 중 이 예약의 몫
--   · 제외: 배송비, 무료배송 쿠폰이 깎은 배송비분, 구매(판매전용) 예약(적립 대상 아님), 보증금. 회원 등급 배율은 없다.
--   · 할인 풀은 주문의 모든 라인(대여+구매) 가중치(상품금액+휴무일요금) 비율로 나눈다 — 구매 라인이 흡수한 할인은
--     대여 적립에서 빼지 않는다. 예약 id 오름차순 누적 반올림으로 배분해 예약별 몫의 합이 풀과 정확히 같다(무상태).
--   · 기준금액이 0 이하이면 0p(공통분·구독 보너스 모두).
--
-- 적립률: 공통 적립률(point_earn_rules.rental_complete) — 전 회원 동일. 구독회원은 Migration 603과 같이
--   구독상품 "적립포인트"(tier_benefits.LOYALTY_POINTS) 비율을 같은 기준금액에 추가 적립(더블 적립, 별도 행).
--   멱등키(ref_type 'rental_complete' / 'rental_complete_sub_bonus')·호출 지점은 무변경.
-- 장바구니 "적립 예정 포인트"는 $lib/utils/cartEarnPoints.ts(calcEarnBase)가 같은 식을 쓴다(패리티 테스트로 고정).

CREATE OR REPLACE FUNCTION public.award_rental_complete_points(
  p_reservation_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id        UUID;
  v_duration       TEXT;
  v_order_id       BIGINT;
  v_own_line       NUMERIC;
  v_own_weight     NUMERIC;
  v_prev_weight    NUMERIC;
  v_total_weight   NUMERIC;
  v_membership     NUMERIC;
  v_coupon_total   NUMERIC;
  v_delivery       NUMERIC;
  v_sel_coupon     UUID;
  v_fs_raw         NUMERIC;
  v_fs_part        NUMERIC;
  v_product_coupon NUMERIC;
  v_points_used    NUMERIC;
  v_pool           NUMERIC;
  v_alloc          NUMERIC;
  v_base           NUMERIC;
  v_rate           NUMERIC;
  v_is_active      BOOLEAN;
  v_amount         INT;
  v_new_balance    INT;
  v_plan_id        BIGINT;
  v_sub_params     JSONB;
  v_sub_rate       NUMERIC;
  v_min_purchase   NUMERIC;
  v_max_points     INT;
  v_expiry_days    INT;
  v_bonus_amount   INT;
BEGIN
  -- 멱등성: 공통분·구독보너스분 중 하나라도 이미 지급됐으면 재지급하지 않음
  IF EXISTS (
    SELECT 1 FROM public.point_transactions
     WHERE ref_id = p_reservation_id::text
       AND ref_type IN ('rental_complete', 'rental_complete_sub_bonus')
  ) THEN
    RETURN jsonb_build_object('success', true, 'already_granted', true);
  END IF;

  SELECT rr.user_id, rr.duration_type
    INTO v_user_id, v_duration
    FROM public.rental_reservations rr
   WHERE rr.id = p_reservation_id;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'reservation_not_found');
  END IF;

  -- 구매(판매전용) 예약은 적립 대상이 아니다
  IF v_duration = 'purchase' THEN
    RETURN jsonb_build_object('success', false, 'error', 'purchase_excluded');
  END IF;

  SELECT MAX(oi.order_id), COALESCE(SUM(oi.line_total), 0)
    INTO v_order_id, v_own_line
    FROM public.order_items oi
   WHERE oi.reservation_id = p_reservation_id;

  IF v_order_id IS NULL OR v_own_line IS NULL OR v_own_line <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_rental_fee');
  END IF;

  -- 주문 라인별 가중치(상품금액 + 휴무일 연장요금) — 예약 id 오름차순 누적 반올림 배분의 입력
  SELECT COALESCE(SUM(w.wt), 0),
         COALESCE(SUM(w.wt) FILTER (WHERE w.rid < p_reservation_id), 0),
         COALESCE(MAX(w.wt) FILTER (WHERE w.rid = p_reservation_id), 0)
    INTO v_total_weight, v_prev_weight, v_own_weight
    FROM (
      SELECT it.rid,
             it.lt + COALESCE(
               (SELECT line.holiday_extra_fee FROM public.compute_reservation_line_amount(it.rid) AS line LIMIT 1), 0
             ) AS wt
        FROM (
          SELECT oi.reservation_id AS rid, SUM(oi.line_total) AS lt
            FROM public.order_items oi
           WHERE oi.order_id = v_order_id AND oi.reservation_id IS NOT NULL
           GROUP BY oi.reservation_id
        ) it
    ) w;

  -- 할인 풀: 멤버십 할인 + 상품분 쿠폰 할인(무료배송이 깎은 배송비분 제외) + 실제 사용 포인트
  SELECT COALESCE(o.discount_amount, 0), COALESCE(o.coupon_discount_amount, 0),
         COALESCE(o.delivery_fee, 0), o.selected_coupon_id
    INTO v_membership, v_coupon_total, v_delivery, v_sel_coupon
    FROM public.orders o
   WHERE o.id = v_order_id;

  SELECT COALESCE(SUM(c.discount_value), 0)
    INTO v_fs_raw
    FROM public.order_coupons oc
    JOIN public.coupons c ON c.id = oc.coupon_id
   WHERE oc.order_id = v_order_id AND c.discount_type = 'free_shipping';

  IF EXISTS (SELECT 1 FROM public.order_coupons oc WHERE oc.order_id = v_order_id) THEN
    v_fs_part := LEAST(v_fs_raw, v_delivery);
  ELSIF v_sel_coupon IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_coupons uc JOIN public.coupons c ON c.id = uc.coupon_id
     WHERE uc.id = v_sel_coupon AND c.discount_type = 'free_shipping'
  ) THEN
    v_fs_part := v_coupon_total;
  ELSE
    v_fs_part := 0;
  END IF;
  v_product_coupon := GREATEST(v_coupon_total - v_fs_part, 0);

  SELECT COALESCE(SUM(-pt.amount), 0)
    INTO v_points_used
    FROM public.point_transactions pt
   WHERE pt.type = 'use' AND pt.ref_type = 'order' AND pt.ref_id = v_order_id::text;

  v_pool := GREATEST(v_membership, 0) + v_product_coupon + GREATEST(v_points_used, 0);

  IF v_total_weight > 0 AND v_pool > 0 THEN
    v_alloc := ROUND((v_prev_weight + v_own_weight) * v_pool / v_total_weight)
             - ROUND(v_prev_weight * v_pool / v_total_weight);
  ELSE
    v_alloc := 0;
  END IF;

  v_base := GREATEST(v_own_weight - v_alloc, 0);

  -- ① 공통 규칙 — 전 회원 동일(등급 배율 없음)
  v_amount := 0;
  SELECT rate, is_active
    INTO v_rate, v_is_active
    FROM public.point_earn_rules
   WHERE event_type = 'rental_complete';

  IF v_rate IS NOT NULL AND v_is_active IS TRUE THEN
    v_amount := ROUND(v_base * v_rate)::int;
  END IF;

  -- ② 구독회원 추가 보너스("더블 적립") — 구독료 결제 적립(LOYALTY_POINTS)과 동일한 값 재사용
  v_bonus_amount := 0;
  SELECT us.plan_id INTO v_plan_id
    FROM public.user_subscriptions us
   WHERE us.user_id = v_user_id AND us.status = 'active'
   ORDER BY us.started_at DESC
   LIMIT 1;

  IF v_plan_id IS NOT NULL THEN
    SELECT benefit_params INTO v_sub_params
      FROM public.tier_benefits
     WHERE plan_id = v_plan_id AND benefit_type = 'LOYALTY_POINTS' AND is_enabled = true;

    IF FOUND THEN
      v_sub_rate     := COALESCE((v_sub_params->>'points_rate')::numeric, 0) / 100.0;
      v_min_purchase := COALESCE((v_sub_params->>'min_purchase_amount')::numeric, 0);
      v_max_points   := (v_sub_params->>'max_points_per_order')::int;
      v_expiry_days  := COALESCE((v_sub_params->>'points_expiry_days')::int, 365);

      IF v_base >= v_min_purchase THEN
        v_bonus_amount := ROUND(v_base * v_sub_rate)::int;
        IF v_max_points IS NOT NULL THEN
          v_bonus_amount := LEAST(v_bonus_amount, v_max_points);
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_amount <= 0 AND v_bonus_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'zero_amount', 'base_amount', v_base);
  END IF;

  IF v_amount > 0 THEN
    UPDATE public.user_profiles
       SET points = points + v_amount
     WHERE user_id = v_user_id
    RETURNING points INTO v_new_balance;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
    END IF;

    INSERT INTO public.point_transactions(
      user_id, type, amount, balance_after, description, ref_type, ref_id
    )
    VALUES (
      v_user_id, 'earn', v_amount, v_new_balance,
      '대여 완료 적립', 'rental_complete', p_reservation_id::text
    );
  END IF;

  IF v_bonus_amount > 0 THEN
    UPDATE public.user_profiles
       SET points = points + v_bonus_amount
     WHERE user_id = v_user_id
    RETURNING points INTO v_new_balance;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
    END IF;

    INSERT INTO public.point_transactions(
      user_id, type, amount, balance_after, description, ref_type, ref_id, expires_at
    )
    VALUES (
      v_user_id, 'earn', v_bonus_amount, v_new_balance,
      '구독회원 렌탈완료 추가 적립(더블 적립)', 'rental_complete_sub_bonus', p_reservation_id::text,
      now() + (v_expiry_days || ' days')::interval
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'amount', v_amount + v_bonus_amount,
    'common_amount', v_amount,
    'bonus_amount', v_bonus_amount,
    'base_amount', v_base,
    'new_balance', v_new_balance
  );
END;
$$;

REVOKE ALL ON FUNCTION public.award_rental_complete_points(BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.award_rental_complete_points(BIGINT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.award_rental_complete_points(BIGINT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.award_rental_complete_points(BIGINT) TO service_role;

UPDATE public.point_earn_rules
   SET description = '렌탈 완료 — 할인·포인트 차감 후 실결제 대여료(휴무일 연장요금 포함, 배송비·구매·보증금 제외) × 적립률. 구독회원은 구독료 결제 적립(CMS 구독상품 ''혜택관리''의 ''적립포인트'')과 동일한 비율로 같은 기준금액에 추가 적립됩니다(더블 적립).',
       updated_at = now()
 WHERE event_type = 'rental_complete';

-- ── ROLLBACK(참고용) ──
-- Migration 603(실제 DB 등록명 603_award_rental_complete_points_double_stack)의 CREATE OR REPLACE 본문을 재실행.
