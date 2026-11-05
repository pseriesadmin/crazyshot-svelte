-- Migration 792 — 쿠폰 선물 승인(approve_pending_coupon_gift): 이미 보유한 쿠폰이면 "지급됨" 처리 방지 (2026-11-05, Stephen 지시)
--
-- 배경: 승인 API(앱 서버)는 승인 전에 보유 여부를 확인하지만, 같은 순간 두 관리자가 승인하거나 가입 즉시 자동배포(#791)와 겹치면
--       distribute_coupon 이 실제로는 지급하지 않았는데(already_held·already_used) 카드를 'approved'로 바꾸고 고객에게 "도착" 알림이 나갈 수 있다.
-- 구현: distribute_coupon 결과가 already_held·already_used 이면 승인을 실패로 돌려 카드를 대기 상태로 유지한다(한도 도달 처리와 같은 방식).
--       현행 함수 정의를 적용 시점에 읽어 해당 구문만 앵커 치환(멱등, 앵커 불일치 시 중단) — 다른 세션이 같은 함수를 바꿔도 덮어쓰지 않는다.
DO $do$
DECLARE
  v_def text;
  v_a   text := $a$  IF v_dist_result->'results'->0->>'status' = 'limit_reached' THEN
    RETURN jsonb_build_object('ok', false, 'error', '총 발행 개수 한도에 도달해 쿠폰을 지급할 수 없습니다');
  END IF;
$a$;
  v_b   text := $b$  IF v_dist_result->'results'->0->>'status' = 'limit_reached' THEN
    RETURN jsonb_build_object('ok', false, 'error', '총 발행 개수 한도에 도달해 쿠폰을 지급할 수 없습니다');
  END IF;

  -- 이미 보유한 쿠폰(Migration 792) — 새로 지급되지 않았으면 승인하지 않고 카드를 대기 상태로 둔다
  IF v_dist_result->'results'->0->>'status' IN ('already_held', 'already_used') THEN
    RETURN jsonb_build_object('ok', false, 'error', '이미 보유 중인 쿠폰입니다.');
  END IF;
$b$;
  v_n   int;
BEGIN
  v_def := pg_get_functiondef('public.approve_pending_coupon_gift(uuid,uuid,boolean)'::regprocedure);
  IF position('Migration 792' in v_def) > 0 THEN RETURN; END IF;
  v_n := (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a);
  IF v_n <> 1 THEN RAISE EXCEPTION 'approve_pending_coupon_gift anchor mismatch: %', v_n; END IF;
  EXECUTE replace(v_def, v_a, v_b);
END
$do$;

-- ROLLBACK(참고용): 위 추가 블록(Migration 792 주석 포함 IF…END IF)을 제거한 정의로 CREATE OR REPLACE.
