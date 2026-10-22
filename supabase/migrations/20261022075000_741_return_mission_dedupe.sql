-- Migration 741 — 반납등록 미션 포인트 동시 호출 중복 지급 방지 (2026-10-22, sp3 검수 MAJOR-1)
--
-- 배경: #739 의 award_return_register_mission_points 는 "이미 지급했는지 확인 → 포인트 가산 → 내역 기록" 순서(check-then-act)라서,
-- 같은 예약으로 요청 두 건이 거의 동시에 들어오면 둘 다 확인을 통과해 이중 지급될 수 있었다.
-- 이중 방어:
--   ① 예약 단위 트랜잭션 잠금(pg_advisory_xact_lock) — 같은 예약의 지급 호출을 직렬화한다.
--   ② 부분 유일 인덱스 — 같은 예약 번호의 미션 적립 내역은 DB 에서도 단 1건만 허용한다(잠금이 어떤 이유로 빠져도 마지막 방어선).
-- #739 파일은 Stage 에 이미 적용돼 있어 직접 수정하지 않고, 함수를 새로 덮어쓴다(권한은 아래에서 다시 명시).

-- ② 유일 인덱스 (기존 중복이 있으면 생성이 실패한다 — Stage 확인 시 중복 0건)
CREATE UNIQUE INDEX IF NOT EXISTS uq_point_transactions_return_mission
  ON public.point_transactions (ref_id)
  WHERE ref_type = 'return_register_mission';

-- ① 함수 재정의 (본문은 #739 와 동일 + 맨 앞 잠금 + 중복 예외 흡수)
CREATE OR REPLACE FUNCTION public.award_return_register_mission_points(
  p_reservation_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID;
  v_amount      INT;
  v_is_active   BOOLEAN;
  v_new_balance INT;
BEGIN
  -- 같은 예약의 동시 호출을 한 줄로 세운다(트랜잭션이 끝나면 자동 해제)
  PERFORM pg_advisory_xact_lock(hashtextextended('return_register_mission:' || p_reservation_id::text, 0));

  -- 멱등성: 이 예약으로 이미 지급됐으면 재지급하지 않음
  IF EXISTS (
    SELECT 1 FROM public.point_transactions
     WHERE ref_type = 'return_register_mission' AND ref_id = p_reservation_id::text
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

  SELECT amount, is_active
    INTO v_amount, v_is_active
    FROM public.point_earn_rules
   WHERE event_type = 'return_register_mission';

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
    '반납등록 미션 적립', 'return_register_mission', p_reservation_id::text
  );

  RETURN jsonb_build_object('success', true, 'amount', v_amount, 'new_balance', v_new_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.award_return_register_mission_points(BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.award_return_register_mission_points(BIGINT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.award_return_register_mission_points(BIGINT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.award_return_register_mission_points(BIGINT) TO service_role;

-- ── ROLLBACK(참고용) ──
-- DROP INDEX IF EXISTS public.uq_point_transactions_return_mission;
-- (함수는 #739 본문으로 되돌린다 — 잠금 줄만 제거)
