-- Migration 498: use_points()가 point_transactions.ref_id를 항상 NULL로 기록하던 결함 수정
--
-- 배경: CMS 고객상세 "포인트이력" 탭에서 "사용" 내역을 해당 대여로 연결하는 기능을
-- 구현하려다 발견 — use_points RPC(Migration 303)는 p_order_id 파라미터를 실제로 받고
-- ref_type='order'까지 조건부로 설정하면서도, 정작 ref_id에는 항상 NULL만 저장하고 있었다
-- (원본 INSERT문의 VALUES 마지막 값이 p_order_id::text가 아니라 리터럴 NULL). 반면 같은
-- 테이블에 적립 이력을 남기는 award_rental_complete_points(Migration 407)는 ref_id를
-- 정상적으로 채우고 있어 적립/사용 두 경로가 비대칭이었다.
--
-- 실사용 확인: 기존 3개 호출부(confirm-mock/+server.ts, pay-mock/+server.ts,
-- pay-result/+page.server.ts)는 전부 이미 올바른 p_order_id 값을 넘기고 있음 — RPC
-- 내부에서 그 값을 저장하지 않은 것만이 문제였다. 따라서 호출부 코드는 전혀 수정하지
-- 않고, RPC 내부 INSERT문 한 곳만 수정한다. 파라미터 시그니처(UUID, INTEGER, BIGINT
-- DEFAULT NULL)·반환형·잔액검증 로직·REVOKE/GRANT는 Migration 303과 완전히 동일하게
-- 유지(CREATE OR REPLACE로 기존 ACL 보존).
--
-- 참고: 같은 시점 결제확정에 쓰이던 confirm_payment_and_update_reservation은 이미
-- Migration 396에서 DROP된 고아 함수라(Migration 378의 confirm_order_payment_and_update_
-- reservations로 대체됨) 이 마이그레이션의 수정 대상이 아니다.

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
    CASE WHEN p_order_id IS NOT NULL THEN p_order_id::text ELSE NULL END  -- 수정: 더 이상 NULL 고정 아님
  );

  RETURN jsonb_build_object('ok', true, 'deducted', p_points, 'remaining', v_remaining);
END;
$function$;

REVOKE ALL ON FUNCTION public.use_points(UUID, INTEGER, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.use_points(UUID, INTEGER, BIGINT) TO service_role;
