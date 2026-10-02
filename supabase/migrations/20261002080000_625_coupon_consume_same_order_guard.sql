-- Migration 625 — 쿠폰 소진: 같은 주문에서 이미 소진된 쿠폰의 중복 호출 방어 (2026-10-02, sp3 검수 L-1)
--
-- 배경: Migration 623으로 1인당 사용 횟수가 0(무제한) 또는 N>1인 쿠폰은 used_at이 있어도 재사용된다. 그러면 같은 주문의 소진이 두 번 호출될 때
--       (결제 완료 화면 더블클릭·재시도·웹훅 중복) used_count/usage_count가 두 번 올라갈 수 있다.
--       과거에는 used_at이 있으면 항상 ALREADY_USED여서 안전했다.
-- 조치: 이 쿠폰의 마지막 소진 주문(user_coupons.order_id)이 이번 주문과 같으면 한도와 무관하게 ALREADY_USED로 거절(재사용은 다른 주문에서만).
-- 구현: 현행 함수 정의를 적용 시점에 읽어 해당 구문만 앵커 치환(멱등, 앵커 불일치 시 중단).
DO $do$
DECLARE
  v_def text;
  v_n   int;
  v_a1  text := $a$    uc.used_count,
    uc.first_viewed_at,$a$;
  v_b1  text := $b$    uc.used_count,
    uc.order_id,
    uc.first_viewed_at,$b$;
  v_a2  text := $a$  -- 1인당 사용 횟수(per_user_limit) — 0=무제한, N=N번까지, NULL=과거 기본 1회 (Migration 623)$a$;
  v_b2  text := $b$  -- 같은 주문에서 이미 소진된 쿠폰의 중복 호출은 한도와 무관하게 거절 — 더블클릭·재시도 방어 (Migration 625)
  IF v_uc.used_at IS NOT NULL AND p_order_id IS NOT NULL AND v_uc.order_id = p_order_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_USED');
  END IF;

  -- 1인당 사용 횟수(per_user_limit) — 0=무제한, N=N번까지, NULL=과거 기본 1회 (Migration 623)$b$;
BEGIN
  v_def := pg_get_functiondef('private._validate_and_consume_coupon(uuid,bigint,uuid)'::regprocedure);
  IF position('Migration 625' in v_def) > 0 THEN RETURN; END IF;

  v_n := (length(v_def) - length(replace(v_def, v_a1, ''))) / length(v_a1);
  IF v_n <> 1 THEN RAISE EXCEPTION 'consume anchor1 mismatch: %', v_n; END IF;
  v_def := replace(v_def, v_a1, v_b1);

  v_n := (length(v_def) - length(replace(v_def, v_a2, ''))) / length(v_a2);
  IF v_n <> 1 THEN RAISE EXCEPTION 'consume anchor2 mismatch: %', v_n; END IF;
  v_def := replace(v_def, v_a2, v_b2);

  EXECUTE v_def;
END
$do$;
