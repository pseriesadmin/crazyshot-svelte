-- Migration 597 — 포인트 자동적립: 정시 반납(on_time_return) 이벤트 (2026-09-30)
--
-- 배경: point_earn_rules(Migration #50)에 on_time_return 규칙이 있지만 실제로 지급하는
-- 코드가 없었음(award_rental_complete_points #407과 동일한 공백 클래스).
--
-- 정책(Stephen 확정, 2026-09-30): 반납 예정일(end_date) "당일까지"(예정일 이전 조기
-- 반납 포함) 반납을 완료하면 정시로 인정한다. 예정일을 하루라도 넘기면 미지급.
--   (DB 시드 설명 문구는 "당일 반납 시"로 더 엄격했으나, 조기 반납 고객도 정시로
--   인정하는 쪽이 더 합리적이라는 Stephen 판단으로 이번 구현은 "예정일 이전 포함")
--
-- award_rental_complete_points(#407)와 동일한 권한·멱등성·fail-soft 패턴:
--   SECURITY DEFINER + service_role 전용, point_transactions(ref_type, ref_id)로 멱등성 보장,
--   호출 시점(CURRENT_DATE)을 "반납 완료 시점"으로 간주 — 'returned' 전이 성공 직후
--   동기 호출되므로 updated_at이 이후 completed 전이에서 덮어써지는 문제와 무관.
--
-- grade_multipliers는 #407과 동일하게 이번에도 미적용(고객 등급 체계 미정).

CREATE OR REPLACE FUNCTION public.award_on_time_return_points(
  p_reservation_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID;
  v_end_date    DATE;
  v_amount      INT;
  v_is_active   BOOLEAN;
  v_new_balance INT;
BEGIN
  -- 멱등성: 이 예약으로 이미 지급됐으면 재지급하지 않음
  IF EXISTS (
    SELECT 1 FROM public.point_transactions
     WHERE ref_type = 'on_time_return' AND ref_id = p_reservation_id::text
  ) THEN
    RETURN jsonb_build_object('success', true, 'already_granted', true);
  END IF;

  SELECT rr.user_id, rr.end_date
    INTO v_user_id, v_end_date
    FROM public.rental_reservations rr
   WHERE rr.id = p_reservation_id;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'reservation_not_found');
  END IF;

  IF v_end_date IS NULL OR CURRENT_DATE > v_end_date THEN
    RETURN jsonb_build_object('success', false, 'error', 'late_return');
  END IF;

  SELECT amount, is_active
    INTO v_amount, v_is_active
    FROM public.point_earn_rules
   WHERE event_type = 'on_time_return';

  IF v_amount IS NULL OR v_is_active IS NOT TRUE OR v_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'rule_inactive');
  END IF;

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
    '정시 반납 적립', 'on_time_return', p_reservation_id::text
  );

  RETURN jsonb_build_object('success', true, 'amount', v_amount, 'new_balance', v_new_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.award_on_time_return_points(BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.award_on_time_return_points(BIGINT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.award_on_time_return_points(BIGINT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.award_on_time_return_points(BIGINT) TO service_role;

-- ── ROLLBACK(참고용) ──
-- DROP FUNCTION IF EXISTS public.award_on_time_return_points(BIGINT);
