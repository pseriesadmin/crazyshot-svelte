-- Migration 542: apply_subscription_free_shipping — 구독 혜택 "무료배송(FREE_SHIPPING)" 판정 RPC
--   (구독 "혜택관리" 4종 실적용 마스터플랜 Phase 5/6 — ancient-pondering-salamander.md 참고,
--    단 Stephen 확정으로 원 계획(서버가 배송비 전체를 재계산)보다 대폭 단순화됨 — TASK.md
--    2026-09-23 Phase 5 NOW 블록 참고)
--
-- 배경: create-order/+server.ts는 클라이언트(cart/+page.svelte)가 계산해 보낸 deliveryFee를
-- 그대로 신뢰하는 것이 의도된 설계다(Migration 395 — "장바구니 표시금액≠결제금액 불일치"
-- 버그 재발 방지를 위해 일부러 이렇게 만든 것, service-operations.md 등 여러 문서에도 명문화).
-- 이 신뢰 메커니즘·할인구간/쿠폰 계산 로직은 전혀 건드리지 않고, 그 위에 "이 주문에 구독
-- 무료배송 혜택을 적용해도 되는가"만 별도로 판정해서, 해당되면 호출부가 deliveryFee를 0으로
-- 덮어쓸 수 있도록 applies:true만 반환한다(실제 덮어쓰기는 create-order/+server.ts에서 수행).
--
-- shipping_type 판정: rental_reservations.pickup_method/return_method가 rental_method_options.
-- is_delivery_type=true인 방식이면 "배송"으로 취급 — cartShippingFee.ts의 anyPickupDelivery/
-- anyReturnDelivery(클라이언트 미리보기 계산)와 동일 원칙을 서버 SQL로 재현한 것이다. 예약
-- 묶음(reservation_ids) 전체 기준으로 하나라도 배송형이면 그 방향은 배송으로 취급한다(OR 판정,
-- calcShippingFee의 items.some(...)과 동일 원칙). 수령·반납 둘 다 배송이면 round_trip, 하나만
-- 배송이면 one_way, 둘 다 아니면 배송 자체가 없어 혜택 적용 대상이 아니다(NOT_DELIVERY —
-- 이미 배송비가 0일 상황이므로 혜택을 쓸 필요가 없는 정상 케이스).
--
-- method_key 조인 조건(is_delivery_type=true + deleted_at IS NULL)은 set_reservation_shipment_
-- method RPC(Migration #479)가 이미 쓰고 있는 동일 조건을 그대로 재사용한다(신규 판정 기준을
-- 만들지 않음).
--
-- 서비스롤 전용 가드: REVOKE/GRANT로 강제(Migration 537과 동일 원칙 — default privilege가
-- 신규 함수에 anon/authenticated EXECUTE를 자동 부여하는 이 프로젝트 전역 설정, PUBLIC만
-- REVOKE하는 것으로는 불충분).
--
-- 멱등성: 같은 예약묶음(reservation_ids)으로 재호출되면 월 사용횟수를 추가로 소모하지 않고
-- already_applied:true만 반환한다 — 예약묶음 중 최소 id를 ref_id(TEXT, Migration #541로 이미
-- TEXT 전환됨)로 저장해 재호출 여부를 판정한다.
--
-- ⛔ 이번 세션은 stage 검증까지만 — production 마이그레이션 적용은 메인 세션이 배포 지시 시
-- 별도로 처리한다(Stephen 지시, 2026-09-23). git add/commit/push도 실행하지 않는다.

CREATE OR REPLACE FUNCTION public.apply_subscription_free_shipping(
  p_user_id UUID,
  p_reservation_ids BIGINT[]
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
  -- method_key 조인 조건은 set_reservation_shipment_method(Migration #479)와 동일하게
  -- is_delivery_type=true + deleted_at IS NULL만 인정한다.
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

  -- 멱등성: 같은 예약묶음으로 이미 적용된 적 있으면 재사용횟수 소모 없이 그대로 적용 응답
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

  INSERT INTO public.subscription_benefit_usage (user_subscription_id, benefit_type, ref_id, used_month)
  VALUES (v_user_subscription_id, 'FREE_SHIPPING', v_ref_id, date_trunc('month', now())::date);

  RETURN jsonb_build_object('applies', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_subscription_free_shipping(UUID, BIGINT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_subscription_free_shipping(UUID, BIGINT[]) TO service_role;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP FUNCTION IF EXISTS public.apply_subscription_free_shipping(UUID, BIGINT[]);
-- ============================================================
