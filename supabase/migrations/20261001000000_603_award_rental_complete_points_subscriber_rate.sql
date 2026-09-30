-- Migration 603 — 렌탈완료 적립: 구독회원 "더블 적립"(공통 규칙 + 구독료 결제 적립률 추가 지급) (2026-10-01)
--
-- 배경: CMS 포인트 설정 화면의 "렌탈 완료" 규칙에 "등급별 배수"(B×1/P×2/C×3) 컬럼이 표시되고
-- 있었으나, 이 값(point_earn_rules.grade_multipliers)은 어떤 적립 RPC도 실제로 읽지 않는
-- 죽은 값이었다(Migration #407 주석에 이미 명시). Stephen 지시로 이를 실제로 의미 있는
-- 구독회원 전용 렌탈적립 로직으로 대체한다.
--
-- ⛔ 최초 설계(같은 날 초안) 대비 정정: 처음엔 구독회원이 공통 규칙 "대신" 구독상품별
-- 적립률을 적용받는 "대체" 방식 + 별도 신규 혜택종류(RENTAL_COMPLETE_POINTS)를 만들었으나,
-- Stephen이 다시 확정한 최종 정책은 다음과 같이 다르다 — 이 파일은 최종 정책만 반영한다:
--
--   ① 일반 회원 — 공통 규칙(point_earn_rules.rental_complete) 그대로 적용(무변경).
--   ② 구독회원(user_subscriptions.status='active') — 공통 규칙 "모두" 그대로 적용 + 추가로
--      "구독료 결제 적립"(tier_benefits.benefit_type='LOYALTY_POINTS', 기존에 이미 있던
--      혜택 그대로 재사용 — 새 혜택종류 만들지 않음)과 동일한 적립률만큼 렌탈완료 시에도
--      추가로 지급한다("더블 적립" — 공통분 + 구독보너스분을 둘 다 받음).
--   ③ "정기구독 상품별 적립포인트 항목 값 = 구독료 결제 적립"(Stephen) — 즉 렌탈완료
--      보너스는 구독료 결제 시 적립에 쓰는 것과 완전히 같은 값(points_rate·min_purchase_
--      amount·max_points_per_order·points_expiry_days)을 그대로 재사용한다. 별도로 CMS에
--      새 입력 필드를 추가하지 않는다(이미 "적립포인트" 혜택 카드 하나로 양쪽 다 제어됨).
--   ④ 공통 규칙 is_active와 구독보너스(tier_benefits.is_enabled)는 완전히 독립적으로
--      작동 — 공통 규칙을 꺼도 구독보너스는 그대로 지급되고, 반대도 마찬가지.
--
-- 구현: 공통분과 구독보너스분을 각각 독립적으로 계산해 point_transactions에 별도 행으로
-- 기록한다(ref_type='rental_complete' 공통분 / ref_type='rental_complete_sub_bonus'
-- 구독보너스분) — 공통분의 멱등키(ref_type='rental_complete')는 기존과 100% 동일하게 유지해
-- 무회귀를 보장한다. 멱등성 재확인은 두 ref_type 중 하나라도 이미 있으면 전체를 재처리하지
-- 않도록 OR 조건으로 검사한다(공통 규칙이 꺼져 있어 공통분 행이 안 생기는 경우에도, 구독
-- 보너스만 중복 지급되는 것을 막기 위함).
--
-- 구독보너스 계산은 award_subscription_points RPC(Migration #539)의 tier_benefits 조회
-- 패턴을 그대로 재사용(같은 가드필드: min_purchase_amount·max_points_per_order·
-- points_expiry_days). 활성 구독 판별은 프로젝트 전역 관례(user_subscriptions.status='active')
-- 그대로 재사용.

CREATE OR REPLACE FUNCTION public.award_rental_complete_points(
  p_reservation_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      UUID;
  v_line_total   NUMERIC;
  v_rate         NUMERIC;
  v_is_active    BOOLEAN;
  v_amount       INT;
  v_new_balance  INT;
  v_plan_id      BIGINT;
  v_sub_params   JSONB;
  v_sub_rate     NUMERIC;
  v_min_purchase NUMERIC;
  v_max_points   INT;
  v_expiry_days  INT;
  v_bonus_amount INT;
BEGIN
  -- 멱등성: 공통분·구독보너스분 중 하나라도 이미 지급됐으면 재지급하지 않음
  IF EXISTS (
    SELECT 1 FROM public.point_transactions
     WHERE ref_id = p_reservation_id::text
       AND ref_type IN ('rental_complete', 'rental_complete_sub_bonus')
  ) THEN
    RETURN jsonb_build_object('success', true, 'already_granted', true);
  END IF;

  SELECT rr.user_id
    INTO v_user_id
    FROM public.rental_reservations rr
   WHERE rr.id = p_reservation_id;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'reservation_not_found');
  END IF;

  SELECT COALESCE(SUM(line_total), 0)
    INTO v_line_total
    FROM public.order_items
   WHERE reservation_id = p_reservation_id;

  IF v_line_total IS NULL OR v_line_total <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_rental_fee');
  END IF;

  -- ① 공통 규칙 — 일반/구독 회원 구분 없이 전원 동일 적용(기존과 100% 동일 산식)
  v_amount := 0;
  SELECT rate, is_active
    INTO v_rate, v_is_active
    FROM public.point_earn_rules
   WHERE event_type = 'rental_complete';

  IF v_rate IS NOT NULL AND v_is_active IS TRUE THEN
    v_amount := ROUND(v_line_total * v_rate)::int;
  END IF;

  -- ② 구독회원 추가 보너스("더블 적립") — 구독료 결제 적립(LOYALTY_POINTS)과 동일한 값 재사용,
  -- 공통 규칙과 완전히 독립적으로 계산(공통 규칙이 꺼져 있어도 지급됨)
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
      v_max_points   := (v_sub_params->>'max_points_per_order')::int; -- NULL 허용(무제한)
      v_expiry_days  := COALESCE((v_sub_params->>'points_expiry_days')::int, 365);

      IF v_line_total >= v_min_purchase THEN
        v_bonus_amount := ROUND(v_line_total * v_sub_rate)::int;
        IF v_max_points IS NOT NULL THEN
          v_bonus_amount := LEAST(v_bonus_amount, v_max_points);
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_amount <= 0 AND v_bonus_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'zero_amount');
  END IF;

  -- 공통분 지급(있을 때만) — ref_type='rental_complete' 그대로 유지(기존 이력 조회 무변경)
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

  -- 구독보너스분 지급(있을 때만) — 별도 ref_type으로 독립 기록(공통분과 별개 이력)
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
    'new_balance', v_new_balance
  );
END;
$$;

REVOKE ALL ON FUNCTION public.award_rental_complete_points(BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.award_rental_complete_points(BIGINT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.award_rental_complete_points(BIGINT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.award_rental_complete_points(BIGINT) TO service_role;

-- ── rental_complete 규칙 설명 문구 동기화 ──
-- "등급별 배수" 표시 제거(CMS 화면)와 함께 실제 동작을 정확히 설명하도록 갱신. 구체적인
-- 퍼센트 수치는 하드코딩하지 않는다 — 같은 CMS 행에 이미 "적립률(%)" 숫자 컬럼이 실시간
-- 값을 보여주므로, 설명문에 값을 중복 기재하면 나중에 그 값이 바뀌어도 설명문은 따라
-- 바뀌지 않아 다시 옛 값이 박제되는 결함이 재발한다.
UPDATE public.point_earn_rules
   SET description = '렌탈 완료 — 렌탈비 × 적립률. 구독회원은 구독료 결제 적립(CMS 구독상품 ''혜택관리''의 ''적립포인트'')과 동일한 비율로 추가 적립됩니다(더블 적립).',
       updated_at = now()
 WHERE event_type = 'rental_complete';

-- ── ROLLBACK(참고용) ──
-- 이전(Migration #407) 버전으로 되돌리려면 그 파일의 CREATE OR REPLACE 본문을 재실행할 것.
