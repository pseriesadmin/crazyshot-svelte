-- Migration 554: apply_subscription_free_shipping — 판정(preview)과 소진(consume) 분리
--   (구독 "혜택관리" 무료배송 로직 재설계 — Migration 542 후속 수정)
--
-- 배경: 이전 세션(오늘)에서 "무료배송 혜택이 결제 확정 전(hold 신청 시점)에 월 사용횟수를
-- 미리 소진해버리는" 결함을 고치기 위해, 소진 호출을 create-order(hold 시점)에서 결제 확정
-- 화면(pay-mock)으로만 옮겼다. 그런데 재검수(sp3-qa-agent) 중 이 변경이 실제로 돈을 내는
-- 결제 경로(pay-result/+page.server.ts, 토스 실결제)에서는 무료배송이 전혀 적용되지 않는
-- 새로운 회귀를 만든 것이 발견됐다 — 이유는 "배송비를 실제로 얼마 청구할지"는 고객이 토스
-- 결제창에서 결제를 누르는 시점(= hold 신청 이후 계약서명 화면 진입 시점에 이미 orders.
-- final_amount로 확정됨)에 이미 정해지는데, pay-result는 토스가 이미 결제를 승인한 *뒤에*
-- 호출되는 화면이라 그 시점에 배송비를 0원으로 정정해도 실제 청구액과 어긋나기 때문이다.
--
-- 해결: "적용 가능 여부 판정"(청구액 계산에 반영 — hold 신청 시점, 소진 없음)과 "실제 소진"
-- (결제가 실제로 확정되는 시점에만 usage 기록)을 완전히 분리한다.
--   · p_consume = false(신규 3번째 파라미터) — 구독·혜택활성화·배송형일치·월한도 전부 동일하게
--     검사하되, subscription_benefit_usage에 INSERT하지 않고 applies 결과만 반환한다.
--     hold 신청 시점(create-order/+server.ts)에서 배송비를 0원으로 반영할지 결정하는 용도.
--   · p_consume = true(기본값, 기존 동작과 100% 동일) — 위 판정 통과 시 실제로 usage를
--     기록(월 사용횟수 소진)한다. 결제가 실제로 확정되는 두 지점(pay-mock·pay-result)에서만
--     호출한다.
--
-- ⛔ 함수 오버로딩 모호성 회피(products.md §2-3에 이미 문서화된 동일 클래스의 실제 버그 —
-- generate_product_code 2-param/3-param 혼재 시 PGRST203 발생 사례): 기존 2-param 함수를
-- 남겨두고 3-param을 추가하면 PostgREST가 두 오버로드 중 무엇을 호출할지 모호해질 수 있다.
-- 따라서 기존 2-param 함수를 DROP하고 3-param(기본값 포함) 함수 하나만 유지한다 — 앱 코드는
-- 이제부터 항상 p_consume을 명시적으로 전달한다(생략 금지).
--
-- 결제 확정 시점(pay-mock·pay-result)에서 이 RPC 호출이 applies:false를 반환해도(예: hold
-- 신청 시점과 결제 확정 시점 사이에 동시에 진행된 다른 주문이 월 한도를 먼저 소진한 경합)
-- orders.delivery_fee/final_amount는 건드리지 않는다 — 실제 토스 청구는 이미 hold 신청
-- 시점에 확정된 금액으로 끝났으므로, 사후에 그 값을 뒤집으면 청구액과 기록이 어긋나는 새로운
-- 문제가 생긴다(이번에 고치는 문제와 동일한 클래스). 이 경합은 쿠폰(use_coupon)이 결제
-- 확정 시점에 거부되어도 orders.final_amount를 되돌리지 않는 것과 동일한 기존 설계 원칙이다.
--
-- 서비스롤 전용 가드: REVOKE/GRANT로 강제(Migration 537/542와 동일 원칙).
--
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh)
--
-- TDD: src/__tests__/services/subscriptionFreeShippingBenefit.test.ts (p_consume 분기 케이스 추가)

DROP FUNCTION IF EXISTS public.apply_subscription_free_shipping(UUID, BIGINT[]);

CREATE OR REPLACE FUNCTION public.apply_subscription_free_shipping(
  p_user_id UUID,
  p_reservation_ids BIGINT[],
  p_consume BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_subscription_id BIGINT;
  v_plan_id              BIGINT;
  v_params               JSONB;
  v_shipping_type        TEXT;
  v_monthly_limit        INT;
  v_usage_count          INT;
  v_any_pickup_delivery  BOOLEAN;
  v_any_return_delivery  BOOLEAN;
  v_order_shipping_type  TEXT;
  v_ref_id               TEXT;
BEGIN
  SELECT id, plan_id INTO v_user_subscription_id, v_plan_id
  FROM public.user_subscriptions
  WHERE user_id = p_user_id AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_user_subscription_id IS NULL THEN
    RETURN jsonb_build_object('applies', false, 'reason', 'NO_ACTIVE_SUBSCRIPTION');
  END IF;

  SELECT benefit_params INTO v_params
  FROM public.tier_benefits
  WHERE plan_id = v_plan_id AND benefit_type = 'FREE_SHIPPING' AND is_enabled = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('applies', false, 'reason', 'BENEFIT_NOT_ENABLED');
  END IF;

  v_shipping_type := COALESCE(v_params->>'shipping_type', 'round_trip');
  v_monthly_limit := COALESCE((v_params->>'monthly_limit')::int, 1);

  -- 예약 묶음 전체 기준 배송형 판정 — 묶음 내 하나라도 배송형이면 그 방향은 배송으로 취급
  -- (cartShippingFee.ts anyPickupDelivery/anyReturnDelivery와 동일 원칙).
  SELECT
    BOOL_OR(pm.is_delivery_type IS TRUE),
    BOOL_OR(rm.is_delivery_type IS TRUE)
  INTO v_any_pickup_delivery, v_any_return_delivery
  FROM public.rental_reservations rr
  LEFT JOIN public.rental_method_options pm
    ON pm.method_key = rr.pickup_method AND pm.deleted_at IS NULL
  LEFT JOIN public.rental_method_options rm
    ON rm.method_key = rr.return_method AND rm.deleted_at IS NULL
  WHERE rr.id = ANY(p_reservation_ids);

  IF COALESCE(v_any_pickup_delivery, false) AND COALESCE(v_any_return_delivery, false) THEN
    v_order_shipping_type := 'round_trip';
  ELSIF COALESCE(v_any_pickup_delivery, false) OR COALESCE(v_any_return_delivery, false) THEN
    v_order_shipping_type := 'one_way';
  ELSE
    RETURN jsonb_build_object('applies', false, 'reason', 'NOT_DELIVERY');
  END IF;

  IF v_order_shipping_type != v_shipping_type THEN
    RETURN jsonb_build_object('applies', false, 'reason', 'SHIPPING_TYPE_MISMATCH');
  END IF;

  SELECT MIN(x)::text INTO v_ref_id FROM unnest(p_reservation_ids) AS x;

  -- 멱등성: 같은 예약묶음으로 이미 소진된 적 있으면(consume=true로 먼저 호출된 적 있음)
  -- 재사용횟수 소모 없이 그대로 적용 응답. consume=false(판정만) 호출도 이미 소진된 묶음이면
  -- 당연히 applies:true를 반환해야 하므로 이 체크는 p_consume 값과 무관하게 항상 먼저 본다.
  IF EXISTS (
    SELECT 1 FROM public.subscription_benefit_usage
    WHERE user_subscription_id = v_user_subscription_id
      AND benefit_type = 'FREE_SHIPPING' AND ref_id = v_ref_id
  ) THEN
    RETURN jsonb_build_object('applies', true, 'already_applied', true);
  END IF;

  SELECT COUNT(*) INTO v_usage_count
  FROM public.subscription_benefit_usage
  WHERE user_subscription_id = v_user_subscription_id
    AND benefit_type = 'FREE_SHIPPING'
    AND used_month = date_trunc('month', now())::date;

  IF v_usage_count >= v_monthly_limit THEN
    RETURN jsonb_build_object('applies', false, 'reason', 'MONTHLY_LIMIT_REACHED');
  END IF;

  -- 판정만(preview) — hold 신청 시점의 배송비 청구액 계산용, usage를 기록하지 않는다.
  IF NOT p_consume THEN
    RETURN jsonb_build_object('applies', true);
  END IF;

  INSERT INTO public.subscription_benefit_usage (user_subscription_id, benefit_type, ref_id, used_month)
  VALUES (v_user_subscription_id, 'FREE_SHIPPING', v_ref_id, date_trunc('month', now())::date);

  RETURN jsonb_build_object('applies', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_subscription_free_shipping(UUID, BIGINT[], BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_subscription_free_shipping(UUID, BIGINT[], BOOLEAN) TO service_role;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- 2-param 원본(Migration 542)으로 되돌리려면 그 파일의 CREATE OR REPLACE 블록을 재실행하고
-- 아래로 3-param 오버로드를 제거한다.
-- DROP FUNCTION IF EXISTS public.apply_subscription_free_shipping(UUID, BIGINT[], BOOLEAN);
-- ============================================================
