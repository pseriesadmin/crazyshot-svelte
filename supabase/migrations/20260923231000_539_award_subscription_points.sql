-- Migration 539: award_subscription_points — 구독 혜택 "적립포인트" 자동적립 RPC
--   (구독 "혜택관리" 4종 실적용 마스터플랜 Phase 4/6 — ancient-pondering-salamander.md 참고)
--
-- 배경: tier_benefits(benefit_type='LOYALTY_POINTS')가 CMS에서 설정만 가능하고 실제 적립
-- 로직이 전혀 없었다(2026-09-23 검증, TASK.md 기록). 정기 구독결제가 성공할 때마다 청구금액의
-- 일정 비율(points_rate)만큼 포인트를 자동 적립한다. 호출 지점은
-- src/lib/server/subscriptions/chargeSubscription.ts(최초가입 결제 + 정기청구 크론 공유
-- 진입점) — Phase 3(issue_subscription_benefit_coupon)과 동일한 chargeSucceeded 성공 분기에서
-- 나란히 fail-soft로 호출된다.
--
-- 스키마 재검증(메인 세션, 2026-09-23) — 서브에이전트 초안 SQL을 그대로 적용하기 전 직접
-- 마이그레이션 파일을 대조해 확인한 결과:
--   · user_profiles.id = auth.users.id(= user_subscriptions.user_id) — use_points RPC
--     (Migration 303/498)가 동일하게 `WHERE id = p_user_id`로 갱신하는 것과 일치 확인.
--     (user_profiles.user_id는 별도 UNIQUE 컬럼이나, 최신 관례는 id 기준 — 초안 그대로 유효)
--   · point_transactions.type은 실제 ENUM(point_tx_type: earn/use/expire/admin_grant/
--     admin_deduct, Migration #46)이며 'earn'/'expire' 값 존재 확인 — 초안 그대로 유효.
--   · point_transactions.ref_id는 Migration #407에서 TEXT로 이미 전환됨(BIGINT user_subscription_id
--     를 담기 위해 필요) — 초안 그대로 유효.
--   · tier_benefits.benefit_params의 LOYALTY_POINTS 키 이름(points_rate/min_purchase_amount/
--     max_points_per_order/points_expiry_days/is_stackable)은 src/lib/utils/subscriptionBenefits.ts
--     BENEFIT_DEFS.LOYALTY_POINTS.fields와 1:1로 대조해 정확히 일치함을 확인 — 초안 그대로 유효.
--   · user_profiles.points에는 CHECK(points >= 0) 제약(Migration #289)이 있어 UPDATE 시
--     GREATEST 등 별도 방어가 필요하지만, 이 함수는 적립(양수 가산)만 하므로 하한 위반 여지
--     없음 — 수정 불필요.
--   → 스키마 가정은 전부 정확했다(초안 SQL을 구조 변경 없이 그대로 채택, 파일 헤더/주석만 보강).
--
-- 멱등키 설계: 이 프로젝트의 정기청구는 하루 1회(claim_subscriptions_due_for_billing)이므로
-- "구독ID + 오늘 날짜(KST 아님, DB 서버 now() 기준)" 조합을 ref_id로 사용해 같은 날 중복
-- 적립을 차단한다. award_rental_complete_points(Migration 407, 예약ID 단위 멱등키)와 달리
-- 이 이벤트는 "예약"처럼 고유 PK가 없는 반복 이벤트(매일 크론이 도는 정기결제)라 '구독ID:날짜'
-- 조합을 사용한다.
--
-- 서비스롤 전용 가드: REVOKE/GRANT로 강제(default privilege가 신규 함수에 anon/authenticated
-- EXECUTE를 자동 부여하는 이 프로젝트 전역 설정 — Migration 260 발견 사례와 동일 위험).
--
-- ⛔ 이번 세션은 stage 검증까지만 — production 마이그레이션 적용은 메인 세션이 배포 지시 시
-- 별도로 처리한다(Stephen 지시, 2026-09-23).

CREATE OR REPLACE FUNCTION public.award_subscription_points(
  p_user_subscription_id BIGINT,
  p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id      UUID;
  v_plan_id      BIGINT;
  v_params       JSONB;
  v_rate         NUMERIC;
  v_min_purchase NUMERIC;
  v_max_points   INT;
  v_expiry_days  INT;
  v_points       INT;
  v_ref_id       TEXT;
  v_new_balance  INT;
BEGIN
  SELECT user_id, plan_id INTO v_user_id, v_plan_id
  FROM public.user_subscriptions
  WHERE id = p_user_subscription_id;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('issued', false, 'reason', 'SUBSCRIPTION_NOT_FOUND');
  END IF;

  SELECT benefit_params INTO v_params
  FROM public.tier_benefits
  WHERE plan_id = v_plan_id AND benefit_type = 'LOYALTY_POINTS' AND is_enabled = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('issued', false, 'reason', 'BENEFIT_NOT_ENABLED');
  END IF;

  v_rate         := COALESCE((v_params->>'points_rate')::numeric, 0);
  v_min_purchase := COALESCE((v_params->>'min_purchase_amount')::numeric, 0);
  v_max_points   := (v_params->>'max_points_per_order')::int;  -- NULL 허용(무제한)
  v_expiry_days  := COALESCE((v_params->>'points_expiry_days')::int, 365);

  IF p_amount < v_min_purchase THEN
    RETURN jsonb_build_object('issued', false, 'reason', 'MIN_PURCHASE_NOT_MET');
  END IF;

  v_points := ROUND(p_amount * v_rate / 100.0)::int;
  IF v_max_points IS NOT NULL THEN
    v_points := LEAST(v_points, v_max_points);
  END IF;

  IF v_points <= 0 THEN
    RETURN jsonb_build_object('issued', false, 'reason', 'ZERO_POINTS');
  END IF;

  -- 멱등키: 같은 구독의 같은 날짜(day) 청구 1회당 1번만 적립 — 이 프로젝트의 정기청구는
  -- 하루 1회(claim_subscriptions_due_for_billing)이므로 날짜 단위 키로 충분한 중복방지가 됨.
  v_ref_id := p_user_subscription_id::text || ':' || to_char(now(), 'YYYY-MM-DD');

  IF EXISTS (
    SELECT 1 FROM public.point_transactions
    WHERE ref_type = 'subscription_points' AND ref_id = v_ref_id
  ) THEN
    RETURN jsonb_build_object('issued', false, 'reason', 'ALREADY_GRANTED_TODAY');
  END IF;

  UPDATE public.user_profiles
  SET points = points + v_points
  WHERE id = v_user_id
  RETURNING points INTO v_new_balance;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('issued', false, 'reason', 'USER_NOT_FOUND');
  END IF;

  INSERT INTO public.point_transactions(
    user_id, type, amount, balance_after, description, ref_type, ref_id, expires_at
  ) VALUES (
    v_user_id, 'earn', v_points, v_new_balance, '구독 혜택 포인트 적립',
    'subscription_points', v_ref_id, now() + (v_expiry_days || ' days')::interval
  );

  RETURN jsonb_build_object('issued', true, 'amount', v_points, 'new_balance', v_new_balance);
END;
$function$;

REVOKE ALL ON FUNCTION public.award_subscription_points(BIGINT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_subscription_points(BIGINT, NUMERIC) TO service_role;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP FUNCTION IF EXISTS public.award_subscription_points(BIGINT, NUMERIC);
-- ============================================================
