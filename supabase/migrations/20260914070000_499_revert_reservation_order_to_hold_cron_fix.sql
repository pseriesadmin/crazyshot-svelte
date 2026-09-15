-- Migration #499: revert_reservation_order_to_hold — cron 회귀 결함 수정 (Defect 3)
-- 플랜: /Users/stevenmac/.claude/plans/launch-selected-element-element-tag-div-lexical-wand.md §1
--
-- 결함: Migration #492의 step 4(contract_signings.sent_at NULL 리셋)가 v_target_ids
-- (non-terminal 형제만)만 순회한다. 그러나 release_reservation_hold()(Migration #453 pg_cron)는
-- MAX(cs.sent_at)을 ALL order_items 형제(terminal 포함)를 대상으로 계산한다.
-- terminal 형제(예: cancelled)에 오래된 sent_at이 남아있으면 — 이 리셋이 적용되지 않아 —
-- revert 직후 30분이 아니라 수십 초 안에 reverted hold가 expired로 자동 전환되는 치명적 버그.
--
-- 수정 내용:
--   DECLARE 절에 v_all_order_ids BIGINT[] 추가
--   step 2a/2b 이후 v_all_order_ids를 terminal 필터 없이 ALL order_items 예약으로 채움
--   step 4 FOREACH를 v_all_order_ids 기준으로 변경
--   step 3(rental_reservations UPDATE)은 v_target_ids(non-terminal만) 그대로 유지
--
-- 테스트: src/__tests__/services/revertReservationOrderToHold.test.ts EC-5 (신규)
-- 기존 EC-1~4는 이 변경에 영향 없음 (non-terminal 경로 동작은 동일)

CREATE OR REPLACE FUNCTION public.revert_reservation_order_to_hold(
  p_reservation_id  BIGINT,
  p_admin_id        UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id_int   BIGINT;
  v_target_ids     BIGINT[];    -- non-terminal 형제만 (step 3 상태전환용)
  v_all_order_ids  BIGINT[];    -- ALL 형제 포함 (step 4 contract_signings 리셋용 — cron 회귀 방지)
  v_terminal       TEXT[] := ARRAY['completed','cancelled','damage_claimed','expired'];
  v_rid            BIGINT;
  v_contract_id    UUID;
BEGIN
  -- ── 1. order_id 조회 (없으면 단건 처리) ────────────────────────────────────────
  SELECT oi.order_id INTO v_order_id_int
  FROM order_items oi
  WHERE oi.reservation_id = p_reservation_id
  LIMIT 1;

  IF v_order_id_int IS NOT NULL THEN
    -- ── 2a. 주문 전체에서 non-terminal 형제만 수집 (step 3용) ───────────────────
    SELECT ARRAY_AGG(oi.reservation_id ORDER BY oi.reservation_id)
    INTO v_target_ids
    FROM order_items oi
    JOIN rental_reservations rr ON rr.id = oi.reservation_id
    WHERE oi.order_id = v_order_id_int
      AND NOT (rr.status = ANY(v_terminal));

    -- ── 2a-ext. ALL 형제 수집(terminal 포함, step 4용) ─────────────────────────
    -- release_reservation_hold()는 MAX(cs.sent_at) across ALL order siblings를 사용하므로
    -- terminal 형제의 sent_at도 NULL로 리셋하지 않으면 cron이 reverted hold를 즉시 만료시킴
    SELECT ARRAY_AGG(oi.reservation_id ORDER BY oi.reservation_id)
    INTO v_all_order_ids
    FROM order_items oi
    WHERE oi.order_id = v_order_id_int;

  ELSE
    -- ── 2b. order_items 없는 단건(레거시/직접 예약) — 자기 자신만 ──────────────
    -- terminal이 아닌 경우에만 대상에 포함
    IF EXISTS (
      SELECT 1 FROM rental_reservations
      WHERE id = p_reservation_id
        AND NOT (status = ANY(v_terminal))
    ) THEN
      v_target_ids    := ARRAY[p_reservation_id];
      v_all_order_ids := ARRAY[p_reservation_id];
    ELSE
      v_target_ids    := ARRAY[]::BIGINT[];
      v_all_order_ids := ARRAY[]::BIGINT[];
    END IF;
  END IF;

  -- 대상 없음(전부 terminal 이거나 예약 자체 없음) → 성공 반환
  IF v_target_ids IS NULL OR array_length(v_target_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  -- ── 3. 각 대상 예약: hold로 전환 + payment_confirmed_at NULL ────────────────
  --   v_target_ids(non-terminal)만 — terminal 형제는 상태 건드리지 않음
  UPDATE rental_reservations
  SET status               = 'hold',
      payment_confirmed_at = NULL,
      updated_at           = NOW()
  WHERE id = ANY(v_target_ids);

  -- ── 4. 계약 서명 리셋 (cron 회귀 방지 핵심) ───────────────────────────────────
  --   v_all_order_ids(ALL 형제, terminal 포함) — Defect 3 수정 핵심
  --   sent_at = NULL  → release_reservation_hold()가 이 hold를 만료 후보에서 제외
  --   signed_at = NULL, expires_at = NULL  → 서명 완료 상태 초기화
  --   token 재발급  → 기존 서명 딥링크 무효화
  IF v_all_order_ids IS NOT NULL AND array_length(v_all_order_ids, 1) IS NOT NULL THEN
    FOREACH v_rid IN ARRAY v_all_order_ids LOOP
      FOR v_contract_id IN
        SELECT id FROM contracts WHERE reservation_id = v_rid
      LOOP
        UPDATE contract_signings
        SET sent_at    = NULL,
            signed_at  = NULL,
            expires_at = NULL,
            token      = gen_random_uuid()
        WHERE contract_id = v_contract_id;
      END LOOP;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;

-- 권한: service_role 전용 (결제 취소를 동반하는 관리자 전용 RPC)
REVOKE ALL ON FUNCTION public.revert_reservation_order_to_hold(BIGINT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revert_reservation_order_to_hold(BIGINT, UUID)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revert_reservation_order_to_hold(BIGINT, UUID)
  TO service_role;

COMMENT ON FUNCTION public.revert_reservation_order_to_hold(BIGINT, UUID) IS
  'Migration #499 — Migration #492의 cron 회귀 결함(Defect 3) 수정.
   step 4(contract_signings.sent_at NULL 리셋)를 non-terminal 형제(v_target_ids)에서
   ALL order 형제(v_all_order_ids, terminal 포함)로 확장.
   release_reservation_hold()(Migration #453)가 MAX(cs.sent_at) across ALL order siblings를
   기준으로 만료를 판정하므로, terminal 형제의 오래된 sent_at이 남아있으면 reverted hold가
   30분 대신 수초 안에 expired로 자동 전환되는 버그를 해소.
   step 3(rental_reservations 상태 UPDATE)은 여전히 v_target_ids(non-terminal)만 대상.';

-- ============================================================
-- ROLLBACK: Migration #492를 CREATE OR REPLACE로 재실행하면 이 변경이 원복됨
-- ============================================================
