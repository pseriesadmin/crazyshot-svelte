-- Migration 303: 체크아웃 결제승인 시점 포인트 실차감(use_points) RPC 신설
--
-- 배경: 2026-08-19 회원 카트→결제 전체 사이클 재검수 중 발견 — 장바구니에서 포인트 사용을
-- 선택하면 Order Total 화면·결제완료 화면에는 할인이 정상 표시되지만, 실제로는
-- user_profiles.points가 전혀 차감되지 않았다(쿠폰은 use_coupon RPC로 정상 소진되는 것과
-- 대조적). 저장소 전체에 포인트 차감 RPC 자체가 존재하지 않았음(admin_grant_points는
-- 관리자 수동 지급/차감용이라 체크아웃 자동 차감과는 별개 — c31f7c5 커밋에서도 "포인트 관리
-- RPC 5종은 의도적으로 미변경"으로 명시, 체크아웃 차감은 대상이 아니었음).
--
-- Stephen 확정: "결제승인 시점에 쿠폰과 동일하게 차감" — use_coupon과 동일한 시점·패턴으로
-- use_points를 신설해 confirm-mock(현재 실사용 mock 결제 경로)에 연결한다.
--
-- 설계:
--   - user_profiles.points 원자적 차감(UPDATE ... WHERE id = p_user_id AND points >= p_points)
--     — c31f7c5에서 신설된 points >= 0 CHECK 제약과 이중 보장, 잔액 부족 시 즉시 실패 반환.
--   - point_transactions에 type='use'로 이력 기록(기존 admin_grant_points와 동일 테이블 재사용,
--     이 테이블은 이미 존재 — Migration 46).
--   - 반환 형태는 promotion 도메인(admin_grant_points의 success/error)이 아니라 체크아웃
--     도메인 기존 관례(use_coupon의 ok/error)를 따른다 — confirm-mock이 이미 그 파싱 패턴을
--     쓰고 있어 호출부 일관성을 위함.
--   - p_points가 NULL이거나 0 이하면 아무 것도 하지 않고 성공 반환(포인트 미사용 체크아웃은
--     정상 케이스).

CREATE OR REPLACE FUNCTION public.use_points(
  p_user_id UUID,
  p_points  INTEGER,
  p_order_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_remaining INTEGER;
BEGIN
  IF p_points IS NULL OR p_points <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'deducted', 0);
  END IF;

  UPDATE public.user_profiles
  SET points = points - p_points,
      updated_at = now()
  WHERE id = p_user_id
    AND points >= p_points
  RETURNING points INTO v_remaining;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_POINTS');
  END IF;

  INSERT INTO public.point_transactions(user_id, type, amount, balance_after, description, ref_type, ref_id)
  VALUES (
    p_user_id, 'use', -p_points, v_remaining,
    '예약 결제 시 포인트 사용',
    CASE WHEN p_order_id IS NOT NULL THEN 'order' ELSE NULL END,
    NULL
  );

  RETURN jsonb_build_object('ok', true, 'deducted', p_points, 'remaining', v_remaining);
END;
$function$;

REVOKE ALL ON FUNCTION public.use_points(UUID, INTEGER, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.use_points(UUID, INTEGER, BIGINT) TO service_role;

-- confirm_payment_and_update_reservation(실 Toss 경로, 현재 S1-M3 BLOCKED로 미사용)도
-- p_point_amount를 payment_transactions에 기록만 하고 실제 차감은 하지 않던 동일 결함을
-- 안고 있었음 — 이 경로가 나중에 활성화될 때 같은 버그가 재발하지 않도록 여기서 함께 정리.
-- 파라미터 시그니처(순서·타입·기본값)는 변경하지 않는다(CREATE OR REPLACE로 기존 ACL 보존).
CREATE OR REPLACE FUNCTION public.confirm_payment_and_update_reservation(
  p_reservation_id bigint,
  p_user_id uuid,
  p_payment_key text,
  p_order_id text,
  p_idempotency_key text,
  p_total_amount integer,
  p_paid_amount integer,
  p_point_amount integer DEFAULT 0,
  p_coupon_discount integer DEFAULT 0,
  p_payment_method text DEFAULT NULL,
  p_toss_response jsonb DEFAULT NULL,
  p_calc_at timestamp with time zone DEFAULT NULL,
  p_deposit_amount integer DEFAULT 0,
  p_deposit_rate numeric DEFAULT 0,
  p_crazyshot_score integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_payment_id UUID;
  v_deposit_id UUID;
  v_points_result JSONB;
BEGIN
  SELECT id INTO v_payment_id FROM payment_transactions WHERE idempotency_key = p_idempotency_key;
  IF v_payment_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'idempotent', true);
  END IF;

  INSERT INTO payment_transactions (
    reservation_id, user_id, payment_key, order_id, idempotency_key,
    total_amount, paid_amount, point_amount, coupon_discount,
    payment_method, status, toss_response, calc_at, confirmed_at
  ) VALUES (
    p_reservation_id, p_user_id, p_payment_key, p_order_id, p_idempotency_key,
    p_total_amount, p_paid_amount, p_point_amount, p_coupon_discount,
    p_payment_method, 'done', p_toss_response, p_calc_at, now()
  ) RETURNING id INTO v_payment_id;

  UPDATE rental_reservations
  SET payment_confirmed_at = now(), updated_at = now()
  WHERE id = p_reservation_id AND user_id = p_user_id AND status IN ('temp', 'pending', 'hold')
    AND payment_confirmed_at IS NULL;

  PERFORM public.try_confirm_reservation(p_reservation_id);

  IF p_point_amount > 0 THEN
    v_points_result := public.use_points(p_user_id, p_point_amount, NULL);
    IF NOT COALESCE((v_points_result ->> 'ok')::boolean, false) THEN
      RAISE WARNING 'use_points 실패(reservation=%): %', p_reservation_id, v_points_result ->> 'error';
    END IF;
  END IF;

  IF p_deposit_amount > 0 THEN
    INSERT INTO deposit_holds (
      reservation_id, user_id, payment_transaction_id,
      deposit_amount, deposit_rate, crazyshot_score, status, held_at
    ) VALUES (
      p_reservation_id, p_user_id, v_payment_id,
      p_deposit_amount, p_deposit_rate, p_crazyshot_score, 'held', now()
    ) RETURNING id INTO v_deposit_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'deposit_id', v_deposit_id, 'idempotent', false);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'error_code', SQLSTATE);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.confirm_payment_and_update_reservation(
  bigint, uuid, text, text, text, integer, integer, integer, integer, text, jsonb, timestamptz, integer, numeric, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_payment_and_update_reservation(
  bigint, uuid, text, text, text, integer, integer, integer, integer, text, jsonb, timestamptz, integer, numeric, integer
) TO service_role;
