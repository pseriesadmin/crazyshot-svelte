-- Migration 562: 구독 무료배송(FREE_SHIPPING) 혜택 — "월 제한 횟수 무제한" 옵션 지원
--   (apply_subscription_free_shipping, Migration 554 후속 수정)
--
-- 배경: CMS 구독 혜택관리 화면(SubscriptionDetailPanel.svelte)의 "월 제한 횟수" 입력을 비우면
-- benefit_params.monthly_limit이 JSON null로 저장되도록 UI를 변경했다(무제한 의도). 그런데
-- 기존 RPC는 `COALESCE((v_params->>'monthly_limit')::int, 1)`로 값이 없으면(=null 포함)
-- "월 1회 제한"으로 오인했다 — 관리자가 "무제한"으로 비워도 실제로는 가장 빡빡한 제한(월 1회)이
-- 적용되는 정반대 결과였다.
--
-- 수정: monthly_limit이 NULL이면 그 COALESCE 기본값(1)으로 대체하지 않고 NULL 그대로 두며,
-- 월 한도 체크 자체를 monthly_limit이 NULL이 아닐 때만 수행한다(무제한 = 체크를 아예 건너뜀).
-- 그 외 판정 로직(구독·혜택활성화·배송형일치·이미 소진 여부·p_consume 분기)은 Migration 554와
-- 완전히 동일 — 오직 월 한도 체크 부분만 NULL-세이프하게 바꾼다.
--
-- 안전성: 현재 Stage·Production 실제 데이터(Easy/Pop/Crazy pack 3개)는 전부 monthly_limit이
-- 명시적으로 2(숫자)로 설정돼 있어(2026-09-27 직접 조회 확인) 이번 변경으로 기존 동작이
-- 달라지는 플랜은 0건이다 — 앞으로 관리자가 이 필드를 의도적으로 비웠을 때만 새 동작(무제한)이
-- 적용된다.
--
-- TDD: src/__tests__/services/subscriptionFreeShippingBenefit.test.ts (무제한 케이스 추가)

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
  -- ⛔ 2026-09-28 변경: COALESCE(...,1) 제거 — NULL(무제한)을 1회로 오인하던 결함 수정.
  -- monthly_limit 키 자체가 없는 구버전 데이터도 이제는 "무제한"으로 해석된다(과거엔 1회로
  -- 오인). 실제 운영 데이터 3건 전부 명시적으로 2가 들어있어 영향 없음(위 배경 설명 참고).
  v_monthly_limit := (v_params->>'monthly_limit')::int;

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
  -- 재사용횟수 소모 없이 그대로 적용 응답.
  IF EXISTS (
    SELECT 1 FROM public.subscription_benefit_usage
    WHERE user_subscription_id = v_user_subscription_id
      AND benefit_type = 'FREE_SHIPPING' AND ref_id = v_ref_id
  ) THEN
    RETURN jsonb_build_object('applies', true, 'already_applied', true);
  END IF;

  -- ⛔ 2026-09-28 변경: v_monthly_limit이 NULL(무제한)이면 사용횟수 조회·비교 자체를 건너뛴다.
  IF v_monthly_limit IS NOT NULL THEN
    SELECT COUNT(*) INTO v_usage_count
    FROM public.subscription_benefit_usage
    WHERE user_subscription_id = v_user_subscription_id
      AND benefit_type = 'FREE_SHIPPING'
      AND used_month = date_trunc('month', now())::date;

    IF v_usage_count >= v_monthly_limit THEN
      RETURN jsonb_build_object('applies', false, 'reason', 'MONTHLY_LIMIT_REACHED');
    END IF;
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
-- Migration 554의 CREATE OR REPLACE 블록을 재실행하면 COALESCE(...,1) 동작으로 되돌아간다.
-- ============================================================
