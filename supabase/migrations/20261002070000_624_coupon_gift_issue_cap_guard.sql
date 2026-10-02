-- Migration 624 — 쿠폰 선물 승인(approve_pending_coupon_gift): 총 발행 개수 한도 도달 시 "지급됨" 처리 방지 (2026-10-02)
--
-- 배경: Migration 623으로 쿠폰은 총 발행 개수 한도에 도달하면 발급이 조용히 건너뛰어진다. 선물 승인 RPC는 distribute_coupon의 ok만 보고
--       카드를 'approved'로 바꾸고 고객에게 쿠폰이 발급된 것처럼 안내하므로, 한도 도달 시에는 승인을 실패로 돌려 카드를 대기 상태로 유지한다.
-- 구현: 현행 함수 정의를 적용 시점에 읽어 해당 구문만 앵커 치환(멱등, 앵커 불일치 시 중단).
DO $do$
DECLARE
  v_def text;
  v_a   text := $a$  IF NOT (v_dist_result->>'ok')::BOOLEAN THEN
    RETURN jsonb_build_object('ok', false, 'error', '쿠폰 발급에 실패했습니다: ' || COALESCE(v_dist_result->>'error', '알 수 없는 오류'));
  END IF;
$a$;
  v_b   text := $b$  IF NOT (v_dist_result->>'ok')::BOOLEAN THEN
    RETURN jsonb_build_object('ok', false, 'error', '쿠폰 발급에 실패했습니다: ' || COALESCE(v_dist_result->>'error', '알 수 없는 오류'));
  END IF;

  -- 총 발행 개수 한도 도달(Migration 624) — 발급이 건너뛰어졌으면 승인하지 않고 카드를 대기 상태로 둔다
  IF v_dist_result->'results'->0->>'status' = 'limit_reached' THEN
    RETURN jsonb_build_object('ok', false, 'error', '총 발행 개수 한도에 도달해 쿠폰을 지급할 수 없습니다');
  END IF;
$b$;
  v_n   int;
BEGIN
  v_def := pg_get_functiondef('public.approve_pending_coupon_gift(uuid,uuid,boolean)'::regprocedure);
  IF position('Migration 624' in v_def) > 0 THEN RETURN; END IF;
  v_n := (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a);
  IF v_n <> 1 THEN RAISE EXCEPTION 'approve_pending_coupon_gift anchor mismatch: %', v_n; END IF;
  EXECUTE replace(v_def, v_a, v_b);
END
$do$;
