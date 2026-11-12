-- Migration 814: 예약 수정 저장 함수를 'API 전용(service_role 전용)'으로 잠근다.
-- 배경: 811 의 edit_submitted_reservation_order(5인자)는 authenticated 가 직접 호출 가능해 API 의 속도 제한을 우회할 수 있다.
-- 변경: 서버 API(service_role)만 호출하는 for_user 래퍼를 추가하고, 5인자 함수의 authenticated 실행 권한을 회수한다.
--   · for_user 래퍼는 이 트랜잭션 안에서만(set_config local=true) auth.uid() = p_user_id 가 되게 한 뒤 기존 5인자 함수를 그대로 호출한다(로직 복제 없음).
--   · 익명 계정 거절·소유권·서명/결제 가드는 5인자 함수가 그대로 수행한다.
--   · 5인자 함수는 SECURITY DEFINER(소유자 실행)이므로 같은 소유자의 래퍼 안 내부 호출은 authenticated 권한 없이도 가능하다.
--   · get_reservation_edit_state(읽기 전용)는 변경 없음.
-- 롤백: .claude/harness/rollback/814_rollback.sql

CREATE OR REPLACE FUNCTION public.edit_submitted_reservation_order_for_user(
  p_user_id uuid,
  p_reservation_id bigint,
  p_expected_reservation_ids bigint[],
  p_lines jsonb,
  p_selected_coupon_ids uuid[] DEFAULT NULL,
  p_selected_points integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'UNAUTHENTICATED', 'message', '로그인이 필요해요');
  END IF;

  -- auth.uid() 는 request.jwt.claim.sub 또는 request.jwt.claims->>'sub' 를 읽는다(둘 다 설정). local=true → 이 트랜잭션 안에서만 유효.
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);

  RETURN public.edit_submitted_reservation_order(
    p_reservation_id, p_expected_reservation_ids, p_lines, p_selected_coupon_ids, p_selected_points
  );
END;
$$;

REVOKE ALL ON FUNCTION public.edit_submitted_reservation_order_for_user(uuid, bigint, bigint[], jsonb, uuid[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edit_submitted_reservation_order_for_user(uuid, bigint, bigint[], jsonb, uuid[], integer) TO service_role;

-- 5인자 편집 함수: 고객 직접 호출 차단(API 경유만)
REVOKE ALL ON FUNCTION public.edit_submitted_reservation_order(bigint, bigint[], jsonb, uuid[], integer) FROM PUBLIC, anon, authenticated;

-- 적용 직후 확인(기대값):
--   SELECT has_function_privilege('authenticated','public.edit_submitted_reservation_order(bigint, bigint[], jsonb, uuid[], integer)','EXECUTE');  -- false
--   SELECT has_function_privilege('service_role','public.edit_submitted_reservation_order_for_user(uuid, bigint, bigint[], jsonb, uuid[], integer)','EXECUTE');  -- true
--   SELECT has_function_privilege('authenticated','public.edit_submitted_reservation_order_for_user(uuid, bigint, bigint[], jsonb, uuid[], integer)','EXECUTE');  -- false
