-- Migration 540: expire_due_points — 포인트 유효기간 만료 처리(FIFO 재생 방식)
--   (구독 "혜택관리" 4종 실적용 마스터플랜 Phase 4/6 — ancient-pondering-salamander.md 참고)
--
-- 배경: point_transactions.type='expire'는 Migration #46부터 enum에 정의돼 있었으나 이를
-- 실제로 발생시키는 로직이 0곳이었다(award_subscription_points, Migration 539로 도입된
-- expires_at이 있는 적립분을 이 함수가 소비한다).
--
-- 핵심 설계 원칙 — use_points RPC(Migration 303/498, 결제 크리티컬 경로)는 절대 수정하지
-- 않는다. 대신 이 함수는 유저별 point_transactions 전체 이력을 시간순으로 "재생(replay)"해
-- 그때그때 "만료개념 있는 적립분 중 아직 실제로 소비되지 않은 잔량"을 계산한다 — 별도
-- 실시간 잔량 컬럼을 두지 않으므로 use_points/admin 차감 등 기존 차감 경로 어디에도 손댈
-- 필요가 없다(그 방식은 이번 설계에서 의도적으로 배제됨).
--
-- FIFO 재생 알고리즘:
--   1. 유저의 point_transactions를 created_at 오름차순으로 순회.
--   2. type='earn' AND expires_at IS NOT NULL인 행 → "적립 lot"으로 임시 큐(tmp_point_lots)에
--      적재(만료개념 없는 적립은 lot에 넣지 않음 — 영구 유효 취급).
--   3. amount < 0인 모든 행(type IN ('use','admin_deduct','expire')) → 차감액만큼 가장 오래된
--      lot부터 순서대로 소진(FIFO). lot 밖(만료개념 없는 구포인트 풀)에서 나간 차감분은 무시.
--      ⚠️ 'expire' 타입도 반드시 이 차감 재생에 포함해야 한다 — 그래야 이 함수를 여러 번
--      재실행해도 이미 만료 처리한 lot을 또 만료시키지 않는다(멱등성 보장의 핵심).
--   4. 재생이 끝난 뒤, expires_at이 이미 지났는데도(< now()) remaining > 0으로 남은 lot만
--      실제로 만료 처리(user_profiles.points 차감 + type='expire' 거래 기록).
--
-- 스키마 재검증(메인 세션, 2026-09-23): user_profiles.points 하한 CHECK(points >= 0,
-- Migration #289) 존재 확인 — GREATEST(points - remaining, 0)로 방어적 하한 클램프 추가(초안
-- 대비 보강 — 이론상 remaining이 현재 잔액을 초과할 수는 없으나, 관리자 수동 차감 등 외부
-- 개입으로 잔액이 먼저 줄어든 뒤 만료가 뒤늦게 실행되는 경합 상황에 대한 방어적 이중장치).
--
-- 서비스롤 전용 가드: REVOKE/GRANT로 강제(default privilege 자동부여 위험, Migration 260 참고).
--
-- ⛔ 이번 세션은 stage 검증까지만 — production 마이그레이션 적용은 메인 세션이 배포 지시 시
-- 별도로 처리한다(Stephen 지시, 2026-09-23).

CREATE OR REPLACE FUNCTION public.expire_due_points()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id        UUID;
  v_tx             RECORD;
  v_lot            RECORD;
  v_debit          INT;
  v_take           INT;
  v_total_expired  INT := 0;
  v_users_affected INT := 0;
  v_new_balance    INT;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS tmp_point_lots (
    tx_id UUID, remaining INT, expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ
  ) ON COMMIT DROP;

  FOR v_user_id IN
    SELECT DISTINCT user_id FROM public.point_transactions
    WHERE type = 'earn' AND expires_at IS NOT NULL AND expires_at < now()
  LOOP
    TRUNCATE tmp_point_lots;

    -- 이 유저의 전체 이력을 시간순 재생: 만료개념 있는 적립은 큐에 적재, 차감성 거래
    -- (amount<0 — use/admin_deduct/expire 전부 포함, expire도 포함해야 재실행 시 이중만료 방지)
    -- 는 가장 오래된 lot부터 순서대로 소진한다.
    FOR v_tx IN
      SELECT id, type, amount, expires_at, created_at
      FROM public.point_transactions
      WHERE user_id = v_user_id
      ORDER BY created_at ASC, id ASC
    LOOP
      IF v_tx.type = 'earn' AND v_tx.expires_at IS NOT NULL THEN
        INSERT INTO tmp_point_lots VALUES (v_tx.id, v_tx.amount, v_tx.expires_at, v_tx.created_at);
      ELSIF v_tx.amount < 0 THEN
        v_debit := -v_tx.amount;
        FOR v_lot IN SELECT * FROM tmp_point_lots WHERE remaining > 0 ORDER BY created_at ASC LOOP
          EXIT WHEN v_debit <= 0;
          v_take := LEAST(v_lot.remaining, v_debit);
          UPDATE tmp_point_lots SET remaining = remaining - v_take WHERE tx_id = v_lot.tx_id;
          v_debit := v_debit - v_take;
        END LOOP;
        -- v_debit이 남아도 무시 — 만료개념 없는(큐 밖) 구포인트 풀에서 나간 차감분
      END IF;
    END LOOP;

    -- 만료시점이 지났는데 여전히 remaining > 0인 lot만 실제로 만료 처리
    FOR v_lot IN
      SELECT * FROM tmp_point_lots WHERE remaining > 0 AND expires_at < now() ORDER BY created_at ASC
    LOOP
      UPDATE public.user_profiles
      SET points = GREATEST(points - v_lot.remaining, 0)
      WHERE id = v_user_id
      RETURNING points INTO v_new_balance;

      INSERT INTO public.point_transactions(
        user_id, type, amount, balance_after, description, ref_type, ref_id
      ) VALUES (
        v_user_id, 'expire', -v_lot.remaining, v_new_balance,
        '포인트 유효기간 만료', 'point_expiry', v_lot.tx_id::text
      );

      v_total_expired := v_total_expired + v_lot.remaining;
    END LOOP;

    v_users_affected := v_users_affected + 1;
  END LOOP;

  RETURN jsonb_build_object('users_affected', v_users_affected, 'total_expired', v_total_expired);
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_due_points() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_due_points() TO service_role;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP FUNCTION IF EXISTS public.expire_due_points();
-- ============================================================
