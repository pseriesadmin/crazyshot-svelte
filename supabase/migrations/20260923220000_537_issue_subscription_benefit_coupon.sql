-- Migration 537: issue_subscription_benefit_coupon — 구독 혜택 "할인쿠폰" 자동발급 RPC
--   (구독 "혜택관리" 4종 실적용 마스터플랜 Phase 3/6 — ancient-pondering-salamander.md 참고)
--
-- 배경: tier_benefits(benefit_type='DISCOUNT_COUPON')가 CMS에서 설정만 가능하고 실제 발급
-- 로직이 전혀 없었다(2026-09-23 검증, TASK.md 기록). 정기 구독결제가 성공할 때마다(월 발행
-- 횟수 한도 내에서) 정액 할인쿠폰 1장을 자동 발급한다. 호출 지점은
-- src/lib/server/subscriptions/chargeSubscription.ts(최초가입 결제 + 정기청구 크론 공유
-- 진입점) — chargeSucceeded && result.success인 성공 분기에서만 fail-soft로 호출된다.
--
-- ⚠️ 2026-09-23 메인 세션 재검증 정정 — 서브에이전트 초안 주석은 "user_coupons에 issued_at
-- 컬럼이 아예 없다"고 서술했으나, 실제 스키마 조회 결과 issued_at은 존재한다(nullable,
-- DEFAULT now() — created_at과 별도 컬럼). 다만 두 컬럼 다 DEFAULT now()라 이 INSERT가
-- issued_at을 명시하지 않아도 자동으로 now()가 채워지므로 동작 자체는 문제없이 동일하다 —
-- distribute_coupon의 B-4(issued_at→created_at, migration 291) 버그는 issued_at 컬럼이
-- 아직 없던 과거 시점 이야기이며, 그 이후 별도 마이그레이션으로 issued_at이 추가된 것으로
-- 보인다. 향후 세션은 "issued_at이 없다"는 이 구버전 서술을 참고하지 말 것.
--
-- coupons.code_mode='manual'(기본값)로 발급하므로 coupons_code_mode_chk 제약(migration 291)에
-- 따라 code IS NOT NULL이 필수다 — gen_random_uuid() 기반으로 고유 code를 직접 채번한다
-- (coupon_code_sequences 지연채번(sequenced) 경로는 이번 자동발급에 적용하지 않음 — 관리자가
-- 수동으로 배포하는 프로모션 쿠폰과 달리, 구독 혜택 쿠폰은 발급 즉시 1인 전용으로 소비되는
-- 성격이라 지연채번의 이점이 없어 단순화).
--
-- is_subscription_only=false로 설정한 이유: 이미 혜택으로 지급된 쿠폰이므로 "사용 시점에도
-- 구독 상태 유지"라는 추가 제약을 걸지 않음(단순화 — Stephen이 명시하지 않은 부분이라 가장
-- 관대한 기본값 채택, 필요 시 후속 세션에서 조정 가능).
--
-- 서비스롤 전용 가드: is_cms_user()가 아니라 REVOKE/GRANT로 강제한다(default privilege가
-- 신규 함수에 anon/authenticated EXECUTE를 자동 부여하는 이 프로젝트 전역 설정 — Migration 260
-- 발견 사례와 동일 위험, PUBLIC만 REVOKE하는 것으로는 불충분).
--
-- ⛔ 이번 세션은 stage 검증까지만 — production 마이그레이션 적용은 메인 세션이 배포 지시 시
-- 별도로 처리한다(Stephen 지시, 2026-09-23).

CREATE OR REPLACE FUNCTION public.issue_subscription_benefit_coupon(p_user_subscription_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id            UUID;
  v_plan_id            BIGINT;
  v_params             JSONB;
  v_coupon_amount      NUMERIC;
  v_coupon_frequency   INT;
  v_coupon_valid_days  INT;
  v_usage_count        INT;
  v_coupon_id          UUID;
  v_code               TEXT;
BEGIN
  SELECT user_id, plan_id INTO v_user_id, v_plan_id
  FROM public.user_subscriptions
  WHERE id = p_user_subscription_id;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('issued', false, 'reason', 'SUBSCRIPTION_NOT_FOUND');
  END IF;

  SELECT benefit_params INTO v_params
  FROM public.tier_benefits
  WHERE plan_id = v_plan_id AND benefit_type = 'DISCOUNT_COUPON' AND is_enabled = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('issued', false, 'reason', 'BENEFIT_NOT_ENABLED');
  END IF;

  v_coupon_amount := COALESCE((v_params->>'coupon_amount')::numeric, 0);
  v_coupon_frequency := COALESCE((v_params->>'coupon_frequency')::int, 1);
  v_coupon_valid_days := COALESCE((v_params->>'coupon_valid_days')::int, 30);

  IF v_coupon_amount <= 0 THEN
    RETURN jsonb_build_object('issued', false, 'reason', 'INVALID_COUPON_AMOUNT');
  END IF;

  SELECT COUNT(*) INTO v_usage_count
  FROM public.subscription_benefit_usage
  WHERE user_subscription_id = p_user_subscription_id
    AND benefit_type = 'DISCOUNT_COUPON'
    AND used_month = date_trunc('month', now())::date;

  IF v_usage_count >= v_coupon_frequency THEN
    RETURN jsonb_build_object('issued', false, 'reason', 'MONTHLY_LIMIT_REACHED');
  END IF;

  -- code_mode='manual' 경로는 coupons_code_mode_chk 제약상 code NOT NULL 필수 —
  -- gen_random_uuid() 기반 고유값을 직접 채번(coupons.code VARCHAR(50) 부분 UNIQUE 인덱스 준수)
  v_code := 'SUBCPN' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.coupons (
    code, type, discount_type, discount_value, code_mode, display_name,
    validity_type, valid_from, valid_until, is_subscription_only
  ) VALUES (
    v_code, 'subscription', 'fixed', v_coupon_amount, 'manual', '구독 혜택 쿠폰',
    'fixed_period', now(), now() + (v_coupon_valid_days || ' days')::interval, false
  )
  RETURNING id INTO v_coupon_id;

  -- issued_at·created_at 둘 다 DEFAULT now()라 명시 생략(파일 상단 주석 참고)
  INSERT INTO public.user_coupons (user_id, coupon_id)
  VALUES (v_user_id, v_coupon_id);

  INSERT INTO public.subscription_benefit_usage (user_subscription_id, benefit_type, ref_id, used_month)
  VALUES (p_user_subscription_id, 'DISCOUNT_COUPON', v_coupon_id, date_trunc('month', now())::date);

  RETURN jsonb_build_object('issued', true, 'coupon_id', v_coupon_id, 'amount', v_coupon_amount);
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_subscription_benefit_coupon(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_subscription_benefit_coupon(BIGINT) TO service_role;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP FUNCTION IF EXISTS public.issue_subscription_benefit_coupon(BIGINT);
-- ============================================================
