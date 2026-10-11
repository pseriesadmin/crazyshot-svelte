-- Migration #642: 주문당 포인트 차감 1회 보장 — 동시 요청 이중 차감 방지 (2026-10-04, CRITICAL — sp3 재검수 MAJOR-1)
--
-- 배경: pay-mock(0원 확정)이 포인트를 확정 "전에" 차감하도록 바뀌면서, "이 주문의 차감 기록이 이미 있는가"를 조회한 뒤
--   차감하는 방식은 조회와 차감 사이에 잠금이 없어 이중 클릭·동시 요청 두 개가 모두 "기록 없음"을 보고 두 번 차감할 수 있다.
--   use_points에도 멱등 키가 없었다.
-- 변경: ① point_transactions에 "주문당 use 1건" 부분 고유 인덱스 ② use_points가 고유 위반을 잡아 이중 차감을 되돌리고
--   {ok:true, deducted:0, already:true}를 반환(UPDATE와 INSERT를 하나의 하위 트랜잭션으로 묶어 함께 롤백).
--   사전 확인: Production·Stage 모두 주문당 use 기록이 중복된 건 없음(Production 0건 / Stage 4건 모두 서로 다른 주문).
--
-- ROLLBACK (필요 시 수동 실행):
--   DROP INDEX IF EXISTS public.uq_point_transactions_use_per_order;
--   use_points를 Migration 640 정의로 CREATE OR REPLACE 복원(EXCEPTION 블록 제거).

CREATE UNIQUE INDEX IF NOT EXISTS uq_point_transactions_use_per_order
  ON public.point_transactions (ref_id)
  WHERE type = 'use' AND ref_type = 'order';

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
  v_order_points INTEGER;
BEGIN
  IF p_points IS NULL OR p_points <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'deducted', 0);
  END IF;

  IF p_order_id IS NOT NULL THEN
    SELECT selected_points INTO v_order_points FROM public.orders WHERE id = p_order_id;
    IF FOUND AND p_points > COALESCE(v_order_points, 0) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'POINTS_EXCEED_ORDER');
    END IF;
  END IF;

  -- 잔액 차감과 이력 기록을 하나의 하위 트랜잭션으로 묶는다: 같은 주문의 동시 요청이 고유 인덱스를 위반하면
  -- 두 번째 요청의 잔액 차감까지 함께 롤백되어 이중 차감이 일어나지 않는다.
  BEGIN
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
      CASE WHEN p_order_id IS NOT NULL THEN p_order_id::text ELSE NULL END
    );
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', true, 'deducted', 0, 'already', true);
  END;

  RETURN jsonb_build_object('ok', true, 'deducted', p_points, 'remaining', v_remaining);
END;
$function$;

REVOKE ALL ON FUNCTION public.use_points(UUID, INTEGER, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.use_points(UUID, INTEGER, BIGINT) TO service_role;
