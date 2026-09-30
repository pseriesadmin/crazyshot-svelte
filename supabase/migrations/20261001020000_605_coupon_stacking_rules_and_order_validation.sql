-- Migration 605: 쿠폰 다중 선택 — "쿠폰끼리 중복 허용" 설정 + 서버 거부 + 주문 쿠폰 사전검증
--
-- 배경(신고 B-2, 2026-10-01): 장바구니가 쿠폰을 1장만 선택하던 구조를 다중 선택으로 전환한다.
--   DB 백엔드(order_coupons·use_coupons·다중쿠폰 create_reservation_order/sync, Migration 531~534)는
--   Stage·Production에 이미 적용돼 있고 코드만 되돌려져 있었다(531~534 파일은 이번에 저장소로 복원).
--   기존 coupons.allow_stacking은 "멤버십(회원등급) 할인과 함께 적용"만 의미했다(Migration 510/511).
--   쿠폰끼리의 중복 규칙은 별도 컬럼으로 분리한다(Stephen 확정: 2개로 분리).
--
-- 변경:
--   1) coupons.allow_coupon_stacking BOOLEAN NOT NULL DEFAULT true — "쿠폰끼리 중복 허용".
--      정책상 쿠폰끼리 중복은 허용이므로 기본값 true(기존 쿠폰 포함). 운영자가 끄면 그 쿠폰은 다른 쿠폰과 함께 못 쓴다.
--   2) cms_set_allow_coupon_stacking(p_id, p_allow) — CMS가 쿠폰 생성·수정 후 호출하는 전용 설정 RPC
--      (cms_create_coupon/cms_update_coupon의 긴 시그니처에 파라미터를 추가하면 오버로드가 생겨 분리).
--   3) use_coupons — 2장 이상 선택 중 중복 불가 쿠폰이 섞이면 COUPON_STACK_REJECTED:<id>:COUPON_STACKING_NOT_ALLOWED.
--   4) create_reservation_order — 같은 조건이면 COUPON_STACKING_NOT_ALLOWED 예외(할인 적용 전 차단).
--   5) validate_order_coupons(p_user_id, p_order_id, p_user_coupon_ids[]) — 부작용 없는 사전검증.
--      소진 로직(private._validate_and_consume_coupon)을 서브트랜잭션 안에서 실행한 뒤 롤백해
--      "지금 결제하면 이 쿠폰이 통과하는가"를 같은 규칙으로 돌려준다(사용 처리·채번 카운터 모두 롤백).
--      create-order API가 주문 생성 직후 호출해 부적격 쿠폰을 걸러낸다(클라이언트 우회 방어).

-- ── 1) 컬럼 ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS allow_coupon_stacking BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.coupons.allow_coupon_stacking IS
  '쿠폰끼리 중복 사용 허용. false면 이 쿠폰은 다른 쿠폰과 함께 선택·사용할 수 없다. (allow_stacking = 멤버십 할인과의 중복 — 별개)';

-- ── 2) CMS 설정 RPC ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cms_set_allow_coupon_stacking(
  p_id    UUID,
  p_allow BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  UPDATE coupons
  SET allow_coupon_stacking = COALESCE(p_allow, true),
      updated_at = now()
  WHERE id = p_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'COUPON_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.cms_set_allow_coupon_stacking(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cms_set_allow_coupon_stacking(UUID, BOOLEAN) TO authenticated, service_role;

-- ── 3) use_coupons — 중복 불가 쿠폰 혼합 거부 ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.use_coupons(
  p_user_id         UUID,
  p_order_id        BIGINT,
  p_user_coupon_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sorted_ids    UUID[];
  v_id            UUID;
  v_step_result   JSONB;
  v_results       JSONB := '[]'::jsonb;
  v_bad_id        UUID;
BEGIN
  IF p_user_coupon_ids IS NULL OR array_length(p_user_coupon_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_COUPONS_SELECTED');
  END IF;

  SELECT array_agg(x ORDER BY x) INTO v_sorted_ids
  FROM unnest(p_user_coupon_ids) AS x;

  -- 2장 이상 함께 쓸 때 "쿠폰끼리 중복 허용"이 꺼진 쿠폰이 섞여 있으면 전체 거부(all-or-nothing)
  IF array_length(v_sorted_ids, 1) > 1 THEN
    SELECT uc.id INTO v_bad_id
    FROM user_coupons uc
    JOIN coupons c ON c.id = uc.coupon_id
    WHERE uc.id = ANY(v_sorted_ids)
      AND uc.user_id = p_user_id
      AND c.allow_coupon_stacking = false
    ORDER BY uc.id
    LIMIT 1;

    IF v_bad_id IS NOT NULL THEN
      RAISE EXCEPTION 'COUPON_STACK_REJECTED:%:%', v_bad_id, 'COUPON_STACKING_NOT_ALLOWED'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  FOREACH v_id IN ARRAY v_sorted_ids LOOP
    v_step_result := private._validate_and_consume_coupon(p_user_id, p_order_id, v_id);

    IF COALESCE((v_step_result->>'ok')::boolean, false) = false THEN
      RAISE EXCEPTION 'COUPON_STACK_REJECTED:%:%', v_id, COALESCE(v_step_result->>'error', 'UNKNOWN')
        USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO order_coupons (order_id, user_coupon_id, coupon_id, discount_amount)
    VALUES (p_order_id, v_id, (v_step_result->>'coupon_id')::UUID, 0)
    ON CONFLICT (order_id, user_coupon_id) DO NOTHING;

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'user_coupon_id', v_id,
        'ok', true,
        'redeemed_code', v_step_result->>'redeemed_code'
      )
    );
  END LOOP;

  PERFORM sync_order_after_composition_change(p_order_id);

  RETURN jsonb_build_object('ok', true, 'results', v_results);
END;
$function$;

-- ── 4) create_reservation_order — 중복 불가 쿠폰 혼합 차단(함수 본문 전체 교체 없이 한 블록만 삽입) ──────
DO $do$
DECLARE
  v_def    TEXT;
  v_anchor TEXT := E'  v_coupon_id := p_selected_coupon_id;';
  v_guard  TEXT := E'  -- COUPON-STACKING-GUARD (Migration 605): 2장 이상 선택 중 "쿠폰끼리 중복 허용"이 꺼진 쿠폰이 있으면 차단\n'
    || E'  IF p_selected_coupon_ids IS NOT NULL AND array_length(p_selected_coupon_ids, 1) > 1 THEN\n'
    || E'    IF EXISTS (\n'
    || E'      SELECT 1 FROM user_coupons uc JOIN coupons c ON c.id = uc.coupon_id\n'
    || E'      WHERE uc.id = ANY(p_selected_coupon_ids) AND uc.user_id = p_user_id AND c.allow_coupon_stacking = false\n'
    || E'    ) THEN\n'
    || E'      RAISE EXCEPTION ''COUPON_STACKING_NOT_ALLOWED: 중복 사용이 허용되지 않은 쿠폰이 포함되어 있습니다.'';\n'
    || E'    END IF;\n'
    || E'  END IF;\n\n';
  v_count  INT;
BEGIN
  SELECT pg_get_functiondef('public.create_reservation_order(uuid,bigint[],uuid,integer,integer,uuid[])'::regprocedure)
    INTO v_def;

  IF position('COUPON-STACKING-GUARD' IN v_def) > 0 THEN
    RETURN; -- 이미 적용됨(멱등)
  END IF;

  v_count := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'create_reservation_order anchor count mismatch: %', v_count;
  END IF;

  EXECUTE replace(v_def, v_anchor, v_guard || v_anchor);
END
$do$;

-- ── 4b) create_reservation_order 다중쿠폰 경로 결함 수정 ──────────────────────────────────────────────
-- Migration 533의 다중쿠폰 경로(p_selected_coupon_ids IS NOT NULL)는 출력 컬럼 order_id(RETURNS TABLE)와
-- order_coupons.order_id가 이름이 같아 "column reference order_id is ambiguous"로 항상 실패했다
-- (2026-10-01 Stage 재현 — 이전에 이 구조를 배포했다가 되돌린 원인일 가능성이 큼).
--   · DELETE ... WHERE order_id = v_order_id → 별칭으로 한정
--   · ON CONFLICT (order_id, user_coupon_id)  → 제약 이름으로 지정(3곳)
DO $do$
DECLARE
  v_def  TEXT;
  v_del  TEXT := E'DELETE FROM order_coupons WHERE order_id = v_order_id;';
  v_del2 TEXT := E'DELETE FROM order_coupons oc WHERE oc.order_id = v_order_id;';
  v_conf TEXT := E'ON CONFLICT (order_id, user_coupon_id) DO UPDATE';
  v_conf2 TEXT := E'ON CONFLICT ON CONSTRAINT order_coupons_order_id_user_coupon_id_key DO UPDATE';
  v_cnt  INT;
BEGIN
  SELECT pg_get_functiondef('public.create_reservation_order(uuid,bigint[],uuid,integer,integer,uuid[])'::regprocedure)
    INTO v_def;

  IF position(v_del IN v_def) = 0 AND position(v_conf IN v_def) = 0 THEN
    RETURN; -- 이미 수정됨(멱등)
  END IF;

  v_cnt := (length(v_def) - length(replace(v_def, v_del, ''))) / length(v_del);
  IF v_cnt <> 1 THEN RAISE EXCEPTION 'DELETE anchor count mismatch: %', v_cnt; END IF;
  v_cnt := (length(v_def) - length(replace(v_def, v_conf, ''))) / length(v_conf);
  IF v_cnt <> 3 THEN RAISE EXCEPTION 'ON CONFLICT anchor count mismatch: %', v_cnt; END IF;

  EXECUTE replace(replace(v_def, v_del, v_del2), v_conf, v_conf2);
END
$do$;

-- ── 5) validate_order_coupons — 부작용 없는 사전검증(소진 로직을 돌린 뒤 롤백) ─────────────────────────
CREATE OR REPLACE FUNCTION public.validate_order_coupons(
  p_user_id         UUID,
  p_order_id        BIGINT,
  p_user_coupon_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id    UUID;
  v_res   JSONB;
  v_out   JSONB := '[]'::jsonb;
  v_count INT;
BEGIN
  IF p_user_coupon_ids IS NULL OR array_length(p_user_coupon_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'results', '[]'::jsonb);
  END IF;

  v_count := array_length(p_user_coupon_ids, 1);

  FOREACH v_id IN ARRAY p_user_coupon_ids LOOP
    v_res := NULL;
    BEGIN
      v_res := private._validate_and_consume_coupon(p_user_id, p_order_id, v_id);
      -- 소진(used_at·usage_count·채번 카운터) 부작용을 전부 되돌리기 위해 서브트랜잭션을 의도적으로 실패시킨다.
      -- PL/pgSQL은 예외로 롤백돼도 지역변수 v_res에 이미 대입된 값은 유지한다.
      RAISE EXCEPTION 'VALIDATE_PROBE_ROLLBACK' USING ERRCODE = 'P0001';
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    IF v_res IS NULL THEN
      v_res := jsonb_build_object('ok', false, 'error', 'VALIDATION_FAILED');
    END IF;

    IF COALESCE((v_res->>'ok')::boolean, false)
       AND v_count > 1
       AND EXISTS (
         SELECT 1 FROM user_coupons uc JOIN coupons c ON c.id = uc.coupon_id
         WHERE uc.id = v_id AND c.allow_coupon_stacking = false
       )
    THEN
      v_res := jsonb_build_object('ok', false, 'error', 'COUPON_STACKING_NOT_ALLOWED');
    END IF;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'user_coupon_id', v_id,
      'ok', COALESCE((v_res->>'ok')::boolean, false),
      'error', v_res->>'error'
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'ok', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_out) e WHERE (e->>'ok')::boolean = false),
    'results', v_out
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_order_coupons(UUID, BIGINT, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_order_coupons(UUID, BIGINT, UUID[]) TO service_role;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP FUNCTION IF EXISTS public.validate_order_coupons(UUID, BIGINT, UUID[]);
-- DROP FUNCTION IF EXISTS public.cms_set_allow_coupon_stacking(UUID, BOOLEAN);
-- use_coupons / create_reservation_order는 적용 전 스냅샷(.claude/harness/learnings/*_snapshot_2026-10-01.sql)으로 교체
-- ALTER TABLE public.coupons DROP COLUMN IF EXISTS allow_coupon_stacking;  -- CMS 화면이 더 이상 참조하지 않을 때만
