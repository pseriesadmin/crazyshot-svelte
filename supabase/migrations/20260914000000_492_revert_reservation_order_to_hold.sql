-- Migration #492: revert_reservation_order_to_hold RPC
-- Harness Flow v3.2 | TDD GREEN
-- 플랜: /Users/stevenmac/.claude/plans/launch-selected-element-element-tag-div-lexical-wand.md §1
--
-- 목적: CMS "예약변경" 버튼 — confirmed(계약완료) 예약을 hold(신청대기)로 되돌려 재조정 가능하게 함.
--   주문(order) 전체 단위로 처리(cancel_reservation_payment 동일 패턴).
--   PG 실결제 취소는 앱 레이어(changeReservation 액션 + Toss API)에서 별도 처리.
--   이 RPC는 rental_reservations 상태 복귀 + contract_signings 리셋만 담당.
--
-- ⚠️ cron 회귀 방지 필수 설계:
--   release_reservation_hold() pg_cron은 contract_signings.sent_at 기준 30분 초과 시
--   hold를 expired로 자동 전환한다. confirmed였던 예약은 이미 sent_at이 오래된 값이므로,
--   이 RPC가 sent_at을 NULL로 리셋하지 않으면 되돌린 지 1분 안에 expired로 튕겨나간다.
--   → sent_at = NULL: SQL 3치논리상 NULL < NOW()-INTERVAL '30 minutes'는 FALSE
--     → cron 만료 후보에서 자동 제외 (별도 분기 불필요)
--
-- 테스트: src/__tests__/services/revertReservationOrderToHold.test.ts (EC-1~4)
-- 완료기준:
--   정상동작: 형제 예약 전체 hold 전환 + payment_confirmed_at NULL + contract_signings 리셋
--   막아야할것: terminal(cancelled/completed/damage_claimed/expired) 형제는 건드리지 않음
--   실패했을때: cron 회귀 — release_reservation_hold() 직접 호출 후에도 hold 유지

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
  v_target_ids     BIGINT[];
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
    -- ── 2a. 주문 전체에서 non-terminal 형제만 수집 ─────────────────────────────
    SELECT ARRAY_AGG(oi.reservation_id ORDER BY oi.reservation_id)
    INTO v_target_ids
    FROM order_items oi
    JOIN rental_reservations rr ON rr.id = oi.reservation_id
    WHERE oi.order_id = v_order_id_int
      AND NOT (rr.status = ANY(v_terminal));
  ELSE
    -- ── 2b. order_items 없는 단건(레거시/직접 예약) — 자기 자신만 ──────────────
    -- terminal이 아닌 경우에만 대상에 포함
    IF EXISTS (
      SELECT 1 FROM rental_reservations
      WHERE id = p_reservation_id
        AND NOT (status = ANY(v_terminal))
    ) THEN
      v_target_ids := ARRAY[p_reservation_id];
    ELSE
      v_target_ids := ARRAY[]::BIGINT[];
    END IF;
  END IF;

  -- 대상 없음(전부 terminal 이거나 예약 자체 없음) → 성공 반환
  IF v_target_ids IS NULL OR array_length(v_target_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  -- ── 3. 각 대상 예약: hold로 전환 + payment_confirmed_at NULL ────────────────
  UPDATE rental_reservations
  SET status               = 'hold',
      payment_confirmed_at = NULL,
      updated_at           = NOW()
  WHERE id = ANY(v_target_ids);

  -- ── 4. 계약 서명 리셋 (cron 회귀 방지 핵심) ───────────────────────────────────
  --   sent_at = NULL  → release_reservation_hold()가 이 hold를 만료 후보에서 제외
  --   signed_at = NULL, expires_at = NULL  → 서명 완료 상태 초기화
  --   token 재발급  → 기존 서명 딥링크 무효화
  --   contracts.content_blocks 등 콘텐츠는 보존 (가벼운 리셋 — cancel_issued_contract 1단계와 동일)
  FOREACH v_rid IN ARRAY v_target_ids LOOP
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
  'Migration #492 — CMS 예약변경 RPC.
   confirmed(계약완료) 예약을 hold(신청대기)로 주문 전체 단위로 되돌린다.
   terminal(completed/cancelled/damage_claimed/expired) 형제는 건드리지 않음.
   contract_signings.sent_at을 NULL로 리셋해 release_reservation_hold() pg_cron
   회귀(되돌린 hold가 1분 안에 expired로 자동 만료되는 치명적 버그)를 방지한다.
   PG 실결제 취소는 앱 레이어(changeReservation 액션)에서 별도로 Toss API 호출.';

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP FUNCTION IF EXISTS public.revert_reservation_order_to_hold(BIGINT, UUID);
-- ============================================================
